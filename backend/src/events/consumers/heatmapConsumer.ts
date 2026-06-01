/**
 * src/events/consumers/heatmapConsumer.ts
 * Redis Streams consumer — invalidates heatmap cache on 'route.completed' events.
 *
 * Consumer group: 'heatmap-consumers', worker ID: 'heatmap-worker-1'.
 * XREADGROUP with BLOCK 5000 to avoid busy-waiting.
 *
 * Shutdown contract:
 *   - Set isShuttingDown = true before closing connections (server.ts).
 *   - The while loop checks the flag at every iteration and exits cleanly.
 *   - Consumer NEVER calls process.exit() (Rule 4.3, Rule 12).
 *
 * Rule 9.3: Winston logger only.
 * Rule 3.1: Redis is optional — consumer guards against unavailability.
 */
import logger from '../../config/logger';
import { getRedisClient, cacheAvailable } from '../../config/redis';
import { invalidateHeatmapCache } from '../../services/heatmap.service';
import { STREAMS } from '../producer';

// ─────────────────────────────────────────────────────────────────────────────
// Shutdown flag — set by server.ts before closing Redis
// ─────────────────────────────────────────────────────────────────────────────

export let isShuttingDown = false;

/** Called by server.ts during graceful shutdown to signal the loop to exit. */
export function signalHeatmapConsumerShutdown(): void {
  isShuttingDown = true;
  logger.info('[heatmapConsumer] Shutdown signalled');
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumer
// ─────────────────────────────────────────────────────────────────────────────

const GROUP = 'heatmap-consumers';
const CONSUMER = 'heatmap-worker-1';

/** Sleep helper — avoids busy-waiting after transient errors */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse ioredis xreadgroup result into a flat messages list.
 * ioredis returns: [stream, [[msgId, [k, v, k, v, ...]], ...]]
 */
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
 * Start the heatmap cache invalidation consumer.
 * Must be called from server.ts AFTER MongoDB and Redis connect.
 *
 * Does NOT return — runs in an infinite loop until isShuttingDown = true.
 */
export async function startHeatmapConsumer(): Promise<void> {
  // Guard: Redis required for stream consumers
  if (!cacheAvailable) {
    logger.warn('[heatmapConsumer] Redis unavailable — consumer not started');
    return;
  }

  const redis = getRedisClient();

  // Create consumer group (idempotent — ignore 'group already exists' error)
  try {
    await redis.xgroup('CREATE', STREAMS.ROUTE_EVENTS, GROUP, '0', 'MKSTREAM');
    logger.info('[heatmapConsumer] Consumer group created', { group: GROUP, stream: STREAMS.ROUTE_EVENTS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('BUSYGROUP')) {
      logger.warn('[heatmapConsumer] Unexpected xgroup CREATE error', { error: msg });
    }
    // 'BUSYGROUP' = group already exists — this is expected, continue
  }

  logger.info('[heatmapConsumer] Starting consumer loop', { group: GROUP, consumer: CONSUMER });

  while (!isShuttingDown) {
    try {
      // XREADGROUP: block up to 5s waiting for new messages
      const results = await (redis.xreadgroup as Function)(
        'GROUP', GROUP, CONSUMER,
        'COUNT', '10',
        'BLOCK', '5000',
        'STREAMS', STREAMS.ROUTE_EVENTS, '>',
      ) as [string, [string, string[]][]][] | null;

      if (!results) continue; // BLOCK timeout — no messages, check shutdown flag

      const messages = parseXreadgroupResult(results);

      for (const msg of messages) {
        try {
          const { fields, id } = msg;

          if (fields['type'] === 'route.completed') {
            const routeId = fields['routeId'];
            const userId = fields['userId'];

            logger.debug('[heatmapConsumer] Invalidating heatmap cache', { routeId, userId });
            await invalidateHeatmapCache(userId);

            // ACK the message after successful processing
            await redis.xack(STREAMS.ROUTE_EVENTS, GROUP, id);
          } else {
            // Unknown type — ACK anyway to avoid re-delivery
            await redis.xack(STREAMS.ROUTE_EVENTS, GROUP, id);
          }
        } catch (msgErr) {
          // Individual message error — log and continue, do NOT crash the loop
          logger.error('[heatmapConsumer] Error processing message', {
            id: msg.id,
            error: msgErr instanceof Error ? msgErr.message : String(msgErr),
          });
          // Do not ACK on error — message stays in PEL for retry
        }
      }
    } catch (loopErr) {
      if (isShuttingDown) break;
      // Outer loop error (e.g., Redis disconnected) — log and wait before retry
      logger.error('[heatmapConsumer] Consumer loop error', {
        error: loopErr instanceof Error ? loopErr.message : String(loopErr),
      });
      await sleep(1_000);
    }
  }

  logger.info('[heatmapConsumer] Consumer loop exited cleanly');
}
