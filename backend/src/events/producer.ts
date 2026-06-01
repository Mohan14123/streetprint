/**
 * src/events/producer.ts
 * Redis Streams event producer.
 *
 * emitEvent() wraps redis.xadd() with:
 *   - try/catch: emit failure MUST NOT crash the calling service (Rule 3.1)
 *   - error logging at warn level (never rethrows)
 *
 * Rule 9.3: Winston logger only — no console.log.
 * Rule 10.3: Stream names as constants, not hardcoded strings.
 */
import logger from '../config/logger';
import { cacheAvailable, getRedisClient } from '../config/redis';

// ─────────────────────────────────────────────────────────────────────────────
// Stream name constants
// ─────────────────────────────────────────────────────────────────────────────

export const STREAMS = {
  ROUTE_EVENTS: 'route:events',
  PLACE_EVENTS: 'place:events',
} as const;

export type StreamName = (typeof STREAMS)[keyof typeof STREAMS];

// ─────────────────────────────────────────────────────────────────────────────
// emitEvent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append an event to a Redis Stream.
 *
 * Uses XADD with auto-generated message ID ('*').
 * Fields object is flattened to a key-value array for ioredis.
 *
 * CRITICAL: This function NEVER throws. Emit failure is logged and swallowed.
 * The calling service must never depend on this completing successfully.
 *
 * @param stream - Stream name (use STREAMS constants)
 * @param fields - Key-value pairs to store in the stream entry
 */
export async function emitEvent(
  stream: StreamName,
  fields: Record<string, string>,
): Promise<void> {
  if (!cacheAvailable) {
    logger.debug('[producer] Redis unavailable — skipping event emission', { stream, fields });
    return;
  }

  try {
    const redis = getRedisClient();
    // ioredis xadd signature: xadd(key, id, ...fieldValuePairs)
    const fieldArgs = Object.entries(fields).flat();
    await redis.xadd(stream, '*', ...fieldArgs);

    logger.debug('[producer] Event emitted', { stream, type: fields['type'] });
  } catch (err) {
    // Emit failure MUST NOT crash the calling service — log and return
    logger.warn('[producer] emitEvent failed (non-fatal)', {
      stream,
      fields,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
