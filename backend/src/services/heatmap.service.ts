/**
 * src/services/heatmap.service.ts
 * Aggregation + density computation for movement heatmaps.
 *
 * Rule 3.2: Cache key = heatmap:{boundsHash}:{userId|"global"}
 * Rule 3.3: Every SET uses HEATMAP_CACHE_TTL_SECONDS.
 * Rule 7.2: Only completed, isPublic: true routes — unless the query is by the owner.
 * Rule 2.3: All queries use $geoWithin bounds — never full collection scans.
 * Rule 2.3: .limit() applied on aggregation pipeline.
 * Rule 11: No business logic in controllers.
 */
import Route from '../models/Route';
import { env } from '../config/env';
import logger from '../config/logger';
import { cacheGet, cacheSet } from '../config/redis';
import { parseBounds, hashBounds } from '../utils/geoUtils';
import { broadcast } from '../routes/events.routes';
import type { HeatmapResult, HeatmapPoint } from '../types';

// Maximum number of coordinate points processed in one aggregation to prevent OOM
const HEATMAP_COORD_LIMIT = 200_000;

// ────────────────────────────────────────────────────────────────
// Cache Key Builder
// ────────────────────────────────────────────────────────────────

function buildCacheKey(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  userId?: string,
): string {
  const boundsHash = hashBounds(minLng, minLat, maxLng, maxLat);
  const userToken = userId ?? 'global';
  return `heatmap:${boundsHash}:${userToken}`;
}

// ────────────────────────────────────────────────────────────────
// Heatmap Service
// ────────────────────────────────────────────────────────────────

/**
 * Compute a heatmap for the given bounding box.
 *
 * Strategy:
 * 1. Check Redis cache.
 * 2. If miss: query Route collection via $geoWithin, aggregate coordinate density.
 * 3. Round coordinates to 4 decimal places (≈ 11 m grid), group, count overlaps.
 * 4. Cache result. Return.
 *
 * @param boundsString - "minLng,minLat,maxLng,maxLat"
 * @param userId - Optional — filter to this user's routes; otherwise all public routes
 */
export async function getHeatmap(
  boundsString: string,
  userId?: string,
): Promise<HeatmapResult> {
  // Parse and validate bounds
  const geoWithin = parseBounds(boundsString);
  const [minLng, minLat, maxLng, maxLat] = boundsString.split(',').map(Number);

  // Cache lookup
  const cacheKey = buildCacheKey(minLng, minLat, maxLng, maxLat, userId);
  const cached = await cacheGet(cacheKey);

  if (cached) {
    logger.debug('[heatmap.service] Cache hit', { cacheKey });
    return JSON.parse(cached) as HeatmapResult;
  }

  logger.debug('[heatmap.service] Cache miss — running aggregation', { cacheKey });

  // Build match stage (Rule 7.2: isPublic filter)
  const matchStage: Record<string, unknown> = {
    status: 'completed',
    isPublic: true,
    'geometry.coordinates': {
      // $geoWithin on the geometry — requires 2dsphere index (Rule 2.2)
      // Note: we use $elemMatch to filter on individual coordinates
    },
  };

  // Use $geoWithin on the geometry field itself via a special query
  const geometryMatch: Record<string, unknown> = {
    status: 'completed',
    isPublic: true,
    isPolylineEncoded: false, // Skip encoded routes for now (decoded on read separately)
  };

  if (userId) {
    // Owner can see their own routes even if private — checked here for user-scoped queries
    geometryMatch['user_id'] = userId;
    delete geometryMatch['isPublic'];
  }

  // We query using the $geoWithin box on the geometry LineString
  // MongoDB applies this to the entire geometry document
  geometryMatch['geometry'] = geoWithin;

  void matchStage; // suppress unused variable warning

  // Aggregation: unwind coordinates, round to 4 dp, count overlaps
  const pipeline = [
    { $match: geometryMatch },
    { $limit: 5_000 }, // Rule 2.3: cap collection scan
    { $project: { coordinates: '$geometry.coordinates', _id: 0 } },
    { $unwind: '$coordinates' },
    { $limit: HEATMAP_COORD_LIMIT },
    {
      $project: {
        // Round to 4 decimal places ≈ 11 m grid cell
        lat: {
          $divide: [
            { $round: [{ $multiply: [{ $arrayElemAt: ['$coordinates', 1] }, 1e4] }, 0] },
            1e4,
          ],
        },
        lng: {
          $divide: [
            { $round: [{ $multiply: [{ $arrayElemAt: ['$coordinates', 0] }, 1e4] }, 0] },
            1e4,
          ],
        },
      },
    },
    {
      $group: {
        _id: { lat: '$lat', lng: '$lng' },
        intensity: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        lat: '$_id.lat',
        lng: '$_id.lng',
        intensity: 1,
      },
    },
    { $sort: { intensity: -1 as const } },
    { $limit: 10_000 }, // Cap output to prevent huge payloads
  ];

  const rawPoints = await Route.aggregate<HeatmapPoint>(pipeline);

  const result: HeatmapResult = {
    points: rawPoints,
    generatedAt: new Date().toISOString(),
    cached: false,
  };

  // Cache the result (Rule 3.3: always include TTL)
  const toCache: HeatmapResult = { ...result, cached: true };
  await cacheSet(cacheKey, JSON.stringify(toCache), env.HEATMAP_CACHE_TTL_SECONDS);

  logger.debug('[heatmap.service] Heatmap computed and cached', {
    cacheKey,
    pointCount: rawPoints.length,
    ttlSeconds: env.HEATMAP_CACHE_TTL_SECONDS,
  });

  return result;
}

// ────────────────────────────────────────────────────────────────
// Cache Invalidation
// ────────────────────────────────────────────────────────────────

/**
 * Invalidate all heatmap cache keys that overlap with a given bounding box.
 * Called synchronously on route completion or isPublic toggle (Rule 7.2).
 *
 * Strategy: because the heatmap key includes rounded bounds, we can only
 * delete the specific key if we know the exact bounds. In practice, we use
 * Redis SCAN to find and delete matching keys. This is a best-effort invalidation.
 */
export async function invalidateHeatmapCache(userId?: string): Promise<void> {
  // Attempt to delete known cache pattern
  // Full pattern-based deletion uses SCAN which is handled here
  try {
    const { getRedisClient, cacheAvailable } = await import('../config/redis');
    if (!cacheAvailable) return;

    const redis = getRedisClient();
    const pattern = userId ? `heatmap:*:${userId}` : 'heatmap:*';

    // Use SCAN to find matching keys without blocking (Rule 3.1: Redis is optional)
    let cursor = '0';
    const keysToDelete: string[] = [];

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keysToDelete.push(...keys);
    } while (cursor !== '0');

    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
      logger.debug('[heatmap.service] Cache invalidated', {
        pattern,
        deletedKeys: keysToDelete.length,
      });
      // Notify all connected SSE clients that heatmap data has changed
      broadcast('heatmap:updated', { timestamp: new Date().toISOString() });
    }
  } catch (err) {
    // Non-fatal — cache will expire on its own
    logger.warn('[heatmap.service] Cache invalidation failed (non-fatal)', { error: err });
  }
}
