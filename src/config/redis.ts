/**
 * src/config/redis.ts
 * Redis connection — optional infrastructure.
 * Rule 3.1: System must work without Redis. Never throw to users because Redis is down.
 * Rule 3.1: Redis disconnect → cacheAvailable = false; reconnect → cacheAvailable = true.
 * Rule 3.3: Every SET must include a TTL — enforced at the call site, documented here.
 */
import Redis from 'ioredis';
import logger from './logger';
import { env } from './env';

/** Set to false when Redis is unavailable. Always check before reads/writes. */
export let cacheAvailable = false;

let redisClient: Redis | null = null;

/**
 * Initialize the Redis client.
 * Does NOT throw — Redis is optional infrastructure.
 */
export function createRedisClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    // Do not auto-reconnect indefinitely — ioredis handles this with lazyConnect
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) {
        // Stop aggressive retrying after 10 attempts; wait 30s between attempts
        return 30_000;
      }
      return Math.min(times * 500, 5_000);
    },
    enableReadyCheck: true,
  });

  client.on('connect', () => {
    logger.info('[redis] Redis connected');
  });

  client.on('ready', () => {
    cacheAvailable = true;
    logger.info('[redis] Redis ready — caching enabled');
  });

  client.on('error', (err: Error) => {
    // Only log, never throw — cacheAvailable handles degraded mode
    logger.warn('[redis] Redis error', { message: err.message });
  });

  client.on('close', () => {
    cacheAvailable = false;
    logger.warn('[redis] Redis connection closed — caching disabled');
  });

  client.on('reconnecting', (delay: number) => {
    logger.info(`[redis] Reconnecting in ${delay}ms`);
  });

  redisClient = client;
  return client;
}

/**
 * Connect to Redis. Non-fatal — the app will continue if Redis is unreachable.
 */
export async function connectRedis(): Promise<void> {
  const client = createRedisClient();
  try {
    await client.connect();
  } catch (err) {
    // Non-fatal — cache is simply disabled
    logger.warn('[redis] Could not connect to Redis — caching will be disabled', { error: err });
    cacheAvailable = false;
  }
}

/**
 * Return the initialized Redis client.
 * Always check `cacheAvailable` before calling this.
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error('[redis] Redis client not initialized. Call connectRedis() first.');
  }
  return redisClient;
}

/**
 * Safely get a cached value. Returns null if cache is unavailable or key is missing.
 */
export async function cacheGet(key: string): Promise<string | null> {
  if (!cacheAvailable || !redisClient) return null;
  try {
    return await redisClient.get(key);
  } catch (err) {
    logger.warn('[redis] cacheGet error', { key, error: err });
    return null;
  }
}

/**
 * Safely set a cached value with a mandatory TTL (seconds).
 * Rule 3.3: TTL is always required — this function enforces it at the type level.
 */
export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!cacheAvailable || !redisClient) return;
  try {
    await redisClient.set(key, value, 'EX', ttlSeconds);
  } catch (err) {
    logger.warn('[redis] cacheSet error', { key, error: err });
  }
}

/**
 * Safely delete one or more cache keys (e.g., on route completion or visibility toggle).
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  if (!cacheAvailable || !redisClient || keys.length === 0) return;
  try {
    await redisClient.del(...keys);
  } catch (err) {
    logger.warn('[redis] cacheDel error', { keys, error: err });
  }
}

/**
 * Close the Redis connection cleanly during shutdown.
 * Rule 8: Graceful shutdown step 5.
 */
export async function closeRedis(): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.quit();
    cacheAvailable = false;
    logger.info('[redis] Redis connection closed');
  } catch (err) {
    logger.error('[redis] Error closing Redis connection', { error: err });
  }
}
