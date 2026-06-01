/**
 * src/events/consumers/suggestionConsumer.ts
 * Redis Streams consumer — invalidates suggestion cache on 'route.completed' events.
 *
 * Consumer group: 'suggestion-consumers', worker ID: 'suggestion-worker-1'.
 * XREADGROUP with BLOCK 5000 to avoid busy-waiting.
 *
 * Shutdown contract:
 *   - Set isShuttingDown = true via signalSuggestionConsumerShutdown() from server.ts.
 *   - The while loop checks the flag at every iteration and exits cleanly.
 *   - Consumer NEVER calls process.exit() (Rule 4.3, Rule 12).
 *
 * Rule 9.3: Winston logger only.
 * Rule 3.2: Suggestion cache key pattern: suggestions:{userId}:*
 */
import logger from '../../config/logger';
import { getRedisClient, cacheAvailable } from '../../config/redis';
import { STREAMS } from '../producer';

// ─────────────────────────────────────────────────────────────────────────────
// Shutdown flag
// ─────────────────────────────────────────────────────────────────────────────

export let isShuttingDown = false;

/** Called by server.ts during graceful shutdown. */
export function signalSuggestionConsumerShutdown(): void {
  isShuttingDown = true;
  logger.info('[suggestionConsumer] Shutdown signalled');
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumer
// ─────────────────────────────────────────────────────────────────────────────

const GROUP = 'suggestion-consumers';
const CONSUMER = 'suggestion-worker-1';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseXreadgroupResult(
  results: [string, [string, string[]][]][] | null,
): Array<{ stream: string; id: string; fields: Record<string, string> }> {
  if (!results) return [];
  const messages: Array<{ stream: string; id: string; fields: Record<string, string> }> = [];

  for (const [stream, streamMessages] of results) {
    for (const [id, rawFields] of streamMessages) {
      const fields: Record<string, string> = {};
      for (let i = 0; i < rawFields.length; i += 2) {
        fields[rawFields[i]] = rawFields[i + 1];
      }
      messages.push({ stream, id, fields });
    }
  }
  return messages;
}

/**
 * Invalidate all suggestion cache keys for a given user.
 * Rule 3.2: Key pattern = suggestions:{userId}:*
 */
async function invalidateSuggestionCache(userId: string): Promise<void> {
  if (!cacheAvailable) return;

  const redis = getRedisClient();
  const pattern = `suggestions:${userId}:*`;

  // Use SCAN to find matching keys without blocking the Redis event loop
  let cursor = '0';
  const keysToDelete: string[] = [];

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    keysToDelete.push(...keys);
  } while (cursor !== '0');

  if (keysToDelete.length > 0) {
    await redis.del(...keysToDelete);
    logger.debug('[suggestionConsumer] Suggestion cache invalidated', {
      userId,
      deletedKeys: keysToDelete.length,
    });
  }
}

/**
 * Start the suggestion cache invalidation consumer.
 * Must be called from server.ts AFTER MongoDB and Redis connect.
 *
 * Does NOT return — runs in an infinite loop until isShuttingDown = true.
 */
export async function startSuggestionConsumer(): Promise<void> {
  if (!cacheAvailable) {
    logger.warn('[suggestionConsumer] Redis unavailable — consumer not started');
    return;
  }

  const redis = getRedisClient();

  // Create consumer group
  try {
    await redis.xgroup('CREATE', STREAMS.ROUTE_EVENTS, GROUP, '0', 'MKSTREAM');
    logger.info('[suggestionConsumer] Consumer group created', {
      group: GROUP,
      stream: STREAMS.ROUTE_EVENTS,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('BUSYGROUP')) {
      logger.warn('[suggestionConsumer] Unexpected xgroup CREATE error', { error: msg });
    }
  }

  logger.info('[suggestionConsumer] Starting consumer loop', {
    group: GROUP,
    consumer: CONSUMER,
  });

  while (!isShuttingDown) {
    try {
      const results = await (redis.xreadgroup as Function)(
        'GROUP', GROUP, CONSUMER,
        'COUNT', '10',
        'BLOCK', '5000',
        'STREAMS', STREAMS.ROUTE_EVENTS, '>',
      ) as [string, [string, string[]][]][] | null;

      if (!results) continue;

      const messages = parseXreadgroupResult(results);

      for (const msg of messages) {
        try {
          const { fields, id } = msg;

          if (fields['type'] === 'route.completed') {
            const userId = fields['userId'];

            logger.debug('[suggestionConsumer] Invalidating suggestion cache', { userId });
            await invalidateSuggestionCache(userId);
            await redis.xack(STREAMS.ROUTE_EVENTS, GROUP, id);
          } else {
            await redis.xack(STREAMS.ROUTE_EVENTS, GROUP, id);
          }
        } catch (msgErr) {
          logger.error('[suggestionConsumer] Error processing message', {
            id: msg.id,
            error: msgErr instanceof Error ? msgErr.message : String(msgErr),
          });
        }
      }
    } catch (loopErr) {
      if (isShuttingDown) break;
      logger.error('[suggestionConsumer] Consumer loop error', {
        error: loopErr instanceof Error ? loopErr.message : String(loopErr),
      });
      await sleep(1_000);
    }
  }

  logger.info('[suggestionConsumer] Consumer loop exited cleanly');
}
