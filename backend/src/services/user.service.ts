/**
 * src/services/user.service.ts
 * User account operations — data export, account deletion, aggregate stats.
 *
 * Rule 7.3: userId always comes from JWT — never from request body.
 * Rule 9.2: Never log passwords or tokens.
 * Rule 2.3: Always apply limits to queries.
 * Rule 11: No DB queries in controllers — all DB access here.
 */
import mongoose from 'mongoose';
import User from '../models/User';
import Route from '../models/Route';
import Place from '../models/Place';
import logger from '../config/logger';
import { getRedisClient, cacheAvailable } from '../config/redis';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface UserExportData {
  user: {
    id: string;
    email: string;
    displayName: string;
    createdAt: string;
  };
  routes: Array<{
    id: string;
    sessionId: string;
    status: string;
    tags: string[];
    isPublic: boolean;
    coordinateCount: number;
    startedAt: string;
    endedAt: string | null;
  }>;
  places: Array<{
    id: string;
    label: string;
    notes: string | null;
    location: {
      lat: number;
      lng: number;
    };
    visited: boolean;
    createdAt: string;
  }>;
  exportedAt: string;
}

export interface UserStats {
  totalDistanceMeters: number;
  routeCount: number;
  dayStreak: number;
  placesCount: number;
}

// ────────────────────────────────────────────────────────────────
// Export User Data (GDPR)
// ────────────────────────────────────────────────────────────────

/**
 * Export all user data: profile, routes (metadata only — no full geometry
 * to keep the export manageable), and saved places.
 *
 * @param userId - Authenticated user's MongoDB ObjectId string
 * @returns Complete user data bundle
 */
export async function exportUserData(userId: string): Promise<UserExportData> {
  const user = await User.findById(userId).lean();
  if (!user) {
    const err = new Error('User not found');
    (err as Error & { code: string }).code = 'AUTH_USER_NOT_FOUND';
    throw err;
  }

  // Fetch routes (exclude full geometry to keep export size reasonable)
  const routes = await Route.find(
    { user_id: userId },
    {
      sessionId: 1,
      status: 1,
      tags: 1,
      isPublic: 1,
      coordinateCount: 1,
      startedAt: 1,
      endedAt: 1,
    },
  )
    .sort({ createdAt: -1 })
    .limit(10_000)
    .lean();

  // Fetch saved places
  const places = await Place.find({ user_id: userId })
    .sort({ createdAt: -1 })
    .limit(10_000)
    .lean();

  logger.info('[user.service] User data exported', { userId });

  return {
    user: {
      id: user._id.toString(),
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    },
    routes: routes.map((r) => ({
      id: r._id.toString(),
      sessionId: r.sessionId,
      status: r.status,
      tags: r.tags,
      isPublic: r.isPublic,
      coordinateCount: r.coordinateCount,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    })),
    places: places.map((p) => ({
      id: p._id.toString(),
      label: p.label,
      notes: p.notes ?? null,
      location: {
        lat: p.location.coordinates[1],
        lng: p.location.coordinates[0],
      },
      visited: p.visited,
      createdAt: p.createdAt.toISOString(),
    })),
    exportedAt: new Date().toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────
// Delete User Account (Cascading)
// ────────────────────────────────────────────────────────────────

/**
 * Permanently delete a user account and all associated data.
 *
 * Cascading deletion order:
 * 1. Delete all Route documents for this user
 * 2. Delete all Place documents for this user
 * 3. Revoke all refresh tokens from Redis (session:refresh:{userId}:*)
 * 4. Delete the User document
 *
 * @param userId - Authenticated user's MongoDB ObjectId string
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  const user = await User.findById(userId).lean();
  if (!user) {
    const err = new Error('User not found');
    (err as Error & { code: string }).code = 'AUTH_USER_NOT_FOUND';
    throw err;
  }

  // 1. Delete all routes
  const routeResult = await Route.deleteMany({ user_id: new mongoose.Types.ObjectId(userId) });

  // 2. Delete all places
  const placeResult = await Place.deleteMany({ user_id: new mongoose.Types.ObjectId(userId) });

  // 3. Revoke all refresh tokens from Redis
  if (cacheAvailable) {
    try {
      const redis = getRedisClient();
      const pattern = `session:refresh:${userId}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      logger.info('[user.service] Revoked refresh tokens from Redis', {
        userId,
        tokensRevoked: keys.length,
      });
    } catch (err) {
      // Non-fatal — Redis is optional infrastructure
      logger.warn('[user.service] Failed to revoke Redis tokens during account deletion', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Delete the user document
  await User.deleteOne({ _id: new mongoose.Types.ObjectId(userId) });

  logger.info('[user.service] User account deleted', {
    userId,
    email: user.email,
    routesDeleted: routeResult.deletedCount,
    placesDeleted: placeResult.deletedCount,
  });
}

// ────────────────────────────────────────────────────────────────
// User Aggregate Stats
// ────────────────────────────────────────────────────────────────

/**
 * Compute aggregate statistics for a user's activity.
 *
 * - totalDistanceMeters: Estimated from coordinateCount * average GPS spacing (~5m)
 *   (More accurate computation would require iterating all route coordinates
 *    with haversine — deferred to avoid heavy reads on this endpoint.)
 * - routeCount: Count of completed routes
 * - dayStreak: Consecutive days ending today/yesterday with at least one completed route
 * - placesCount: Total saved places
 *
 * @param userId - Authenticated user's MongoDB ObjectId string
 */
export async function getUserStats(userId: string): Promise<UserStats> {
  // Route stats via aggregation
  const routeAgg = await Route.aggregate<{
    _id: null;
    routeCount: number;
    totalCoords: number;
    dates: Date[];
  }>([
    { $match: { user_id: new mongoose.Types.ObjectId(userId), status: 'completed' } },
    {
      $group: {
        _id: null,
        routeCount: { $sum: 1 },
        totalCoords: { $sum: '$coordinateCount' },
        dates: { $push: '$startedAt' },
      },
    },
  ]);

  const agg = routeAgg[0] ?? { routeCount: 0, totalCoords: 0, dates: [] };

  // Estimate total distance: ~5m average between GPS points is a reasonable approximation
  const AVERAGE_GPS_SPACING_METERS = 5;
  const totalDistanceMeters = Math.round(agg.totalCoords * AVERAGE_GPS_SPACING_METERS);

  // Calculate day streak
  const dayStreak = computeDayStreak(agg.dates);

  // Places count
  const placesCount = await Place.countDocuments({ user_id: new mongoose.Types.ObjectId(userId) });

  return {
    totalDistanceMeters,
    routeCount: agg.routeCount,
    dayStreak,
    placesCount,
  };
}

/**
 * Compute the current consecutive day streak from a list of dates.
 * Counts backwards from today — if today or yesterday has an entry, starts counting.
 */
function computeDayStreak(dates: Date[]): number {
  if (dates.length === 0) return 0;

  // Get unique day strings (YYYY-MM-DD) in user's local TZ (server TZ)
  const daySet = new Set<string>();
  for (const d of dates) {
    const dateStr = new Date(d).toISOString().slice(0, 10);
    daySet.add(dateStr);
  }

  // Check if streak starts from today or yesterday
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  if (!daySet.has(today) && !daySet.has(yesterday)) {
    return 0; // Streak is broken
  }

  // Count consecutive days backwards from the most recent
  let streak = 0;
  let checkDate = daySet.has(today) ? new Date() : new Date(Date.now() - 86400000);

  for (let i = 0; i < 365; i++) {
    const dateStr = checkDate.toISOString().slice(0, 10);
    if (daySet.has(dateStr)) {
      streak++;
      checkDate = new Date(checkDate.getTime() - 86400000);
    } else {
      break;
    }
  }

  return streak;
}
