/**
 * src/services/route.service.ts
 * Core route business logic: session management, GPS filtering, queue delegation.
 *
 * Rule 4.1: Coordinate writes go through Bull queue — NEVER direct MongoDB writes.
 * Rule 5.2: GPS noise filter applied to every incoming coordinate.
 * Rule 5.3: Never simplify routes. Store exact sequences.
 * Rule 5.4: Routes with < ROUTE_MIN_COORDINATES → status: "abandoned".
 * Rule 5.5: Routes > 500 points → polyline-encode geometry before write.
 * Rule 7.1: Active (in-progress) routes never returned in public queries.
 * Rule 11: No DB queries in controllers — all DB access here.
 */
import { randomUUID } from 'crypto';
import Route, { IRoute } from '../models/Route';
import { env } from '../config/env';
import logger from '../config/logger';
import { filterNoisyPoint, haversineDistance, isValidWGS84 } from '../utils/geoUtils';
import {
  encodePolyline,
  requiresPolylineEncoding,
  POLYLINE_ENCODING_THRESHOLD,
} from '../utils/polylineEncoder';
import { enqueueCoordinateWrite, flushRouteJobs } from './queue.service';
import { emitEvent, STREAMS } from '../events/producer';
import { pushToUser } from '../routes/events.routes';
import type { RouteStartResult, RouteUpdateResult } from '../types';

// ────────────────────────────────────────────────────────────────
// Start Session
// ────────────────────────────────────────────────────────────────

/**
 * Begin a new route session for the given user.
 *
 * - If the user already has an active session → auto-abandon it before creating a new one.
 * - Generates a new UUID sessionId.
 * - Creates a Route document with status: "active".
 *
 * Rule 7.1: Active routes are never returned publicly — safe to create freely.
 *
 * @param userId - Authenticated user's MongoDB ObjectId string
 * @returns { sessionId, routeId }
 */
export async function startRoute(userId: string): Promise<RouteStartResult> {
  // Auto-abandon any existing active session for this user
  const existing = await Route.findOne({ user_id: userId, status: 'active' }).lean();

  if (existing) {
    await Route.updateOne(
      { _id: existing._id },
      { $set: { status: 'abandoned', endedAt: new Date() } },
    );
    logger.info('[route.service] Auto-abandoned previous active session', {
      userId,
      abandonedRouteId: existing._id.toString(),
      abandonedSessionId: existing.sessionId,
    });
  }

  const sessionId = randomUUID();

  const route = await Route.create({
    user_id: userId,
    sessionId,
    geometry: { type: 'LineString', coordinates: [] },
    tags: [],
    isPublic: true,
    startedAt: new Date(),
    status: 'active',
    coordinateCount: 0,
    isPolylineEncoded: false,
  });

  logger.info('[route.service] Route session started', {
    userId,
    routeId: route._id.toString(),
    sessionId,
  });

  // Emit route.started event to Redis Stream (non-fatal if Redis is down)
  await emitEvent(STREAMS.ROUTE_EVENTS, {
    type:      'route.started',
    routeId:   route._id.toString(),
    userId,
    sessionId,
    timestamp: new Date().toISOString(),
  });

  return {
    sessionId,
    routeId: route._id.toString(),
  };
}

// ────────────────────────────────────────────────────────────────
// Update Session (GPS Batch)
// ────────────────────────────────────────────────────────────────

/**
 * Process an incoming batch of GPS coordinates for an active session.
 *
 * Steps:
 * 1. Validate the session belongs to the authenticated user.
 * 2. Filter each coordinate through GPS noise filter (Rule 5.2).
 * 3. Push accepted coordinates to Bull queue — NEVER write directly (Rule 4.1).
 * 4. Return { accepted, rejected } immediately (Rule 4.1 — never block on DB).
 *
 * Coordinate format: [lng, lat, timestamp?] — GeoJSON order.
 *
 * @param userId - Authenticated user's MongoDB ObjectId string
 * @param sessionId - Session UUID from /route/start
 * @param rawCoordinates - Incoming coordinate tuples [lng, lat, timestamp?]
 */
export async function updateRoute(
  userId: string,
  sessionId: string,
  rawCoordinates: [number, number, number?][],
): Promise<RouteUpdateResult> {
  // 1. Validate session ownership
  const route = await Route.findOne({ sessionId, status: 'active' }).lean();

  if (!route) {
    const err = new Error(`Session not found or not active: ${sessionId}`);
    (err as Error & { code: string }).code = 'ROUTE_SESSION_NOT_FOUND';
    throw err;
  }

  if (route.user_id.toString() !== userId) {
    const err = new Error(`Session does not belong to authenticated user`);
    (err as Error & { code: string }).code = 'ROUTE_SESSION_NOT_OWNED';
    throw err;
  }

  // 2. GPS noise filtering
  const threshold = env.GPS_JUMP_THRESHOLD_METERS;
  const accepted: [number, number][] = [];
  let rejected = 0;

  // Get the last stored coordinate to compare against for noise filtering
  const coords = route.geometry.coordinates ?? [];
  const lastStored = coords.slice(-1)[0] as [number, number] | undefined;
  let prevCoord: [number, number] | undefined = lastStored;

  for (const coord of rawCoordinates) {
    const [lng, lat] = coord;

    // Validate WGS84 bounds first
    if (!isValidWGS84([lng, lat])) {
      rejected++;
      logger.debug('[route.service] Rejected invalid WGS84 coordinate', {
        routeId: route._id.toString(),
        sessionId,
        rejectedCoord: [lng, lat],
      });
      continue;
    }

    // If we have a previous point, apply noise filter
    if (prevCoord !== undefined) {
      const isValid = filterNoisyPoint(prevCoord, [lng, lat], threshold);
      if (!isValid) {
        rejected++;
        logger.debug('[route.service] Rejected GPS noise', {
          routeId: route._id.toString(),
          sessionId,
          rejectedCoord: [lng, lat],
          prevCoord,
          distanceMeters: 'exceeds threshold',
        });
        continue;
      }
    }

    accepted.push([lng, lat]);
    prevCoord = [lng, lat];
  }

  // 3. Queue accepted coordinates for DB persistence (Rule 4.1)
  if (accepted.length > 0) {
    await enqueueCoordinateWrite(route._id.toString(), accepted);
  }

  logger.debug('[route.service] Coordinate batch processed', {
    userId,
    sessionId,
    routeId: route._id.toString(),
    accepted: accepted.length,
    rejected,
  });

  return { accepted: accepted.length, rejected };
}

// ────────────────────────────────────────────────────────────────
// End Session
// ────────────────────────────────────────────────────────────────

/**
 * Finalize a route session.
 *
 * Steps:
 * 1. Validate session ownership.
 * 2. Flush pending queue jobs for this session (wait up to 10 s).
 * 3. Reload route to get final coordinate count.
 * 4. If < ROUTE_MIN_COORDINATES → set status: "abandoned".
 * 5. If > POLYLINE_ENCODING_THRESHOLD → encode geometry with polyline.
 * 6. Set status: "completed", endedAt: now(), apply tags.
 *
 * @param userId - Authenticated user's MongoDB ObjectId string
 * @param sessionId - Session UUID from /route/start
 * @param tags - Optional route tags e.g. ["food", "exploration"]
 * @returns The final Route document
 */
export async function endRoute(
  userId: string,
  sessionId: string,
  tags: string[] = [],
): Promise<IRoute> {
  // 1. Validate ownership and that session is active
  const route = await Route.findOne({ sessionId, status: 'active' });

  if (!route) {
    const err = new Error(`Active session not found: ${sessionId}`);
    (err as Error & { code: string }).code = 'ROUTE_SESSION_NOT_FOUND';
    throw err;
  }

  if (route.user_id.toString() !== userId) {
    const err = new Error(`Session does not belong to authenticated user`);
    (err as Error & { code: string }).code = 'ROUTE_SESSION_NOT_OWNED';
    throw err;
  }

  const routeId = route._id.toString();

  // 2. Flush pending queue jobs so all GPS writes are persisted before we read count
  await flushRouteJobs(routeId);

  // 3. Reload route to get the latest coordinateCount / geometry from DB
  const refreshed = await Route.findById(routeId);
  if (!refreshed) {
    const err = new Error(`Route disappeared after flush: ${routeId}`);
    (err as Error & { code: string }).code = 'ROUTE_NOT_FOUND';
    throw err;
  }

  const coordCount = refreshed.geometry.coordinates.length;
  const minCoords = env.ROUTE_MIN_COORDINATES;

  // 4. Check minimum coordinate threshold (Rule 5.4)
  if (coordCount < minCoords) {
    refreshed.status = 'abandoned';
    refreshed.endedAt = new Date();
    refreshed.tags = tags;
    await refreshed.save();

    logger.info('[route.service] Route abandoned — insufficient coordinates', {
      userId,
      routeId,
      sessionId,
      coordinateCount: coordCount,
      required: minCoords,
    });

    return refreshed;
  }

  // 5. Polyline encode if > POLYLINE_ENCODING_THRESHOLD (Rule 5.5)
  if (requiresPolylineEncoding(refreshed.geometry.coordinates as [number, number][])) {
    const encoded = encodePolyline(refreshed.geometry.coordinates as [number, number][]);
    // Store encoded string in coordinates as a single-element array wrapping the string
    // The isPolylineEncoded flag signals consumers to decode before use
    (refreshed.geometry as { type: 'LineString'; coordinates: unknown }).coordinates = [encoded] as unknown as [number, number][];
    refreshed.isPolylineEncoded = true;

    logger.info('[route.service] Route geometry polyline-encoded', {
      userId,
      routeId,
      sessionId,
      coordinateCount: coordCount,
      threshold: POLYLINE_ENCODING_THRESHOLD,
    });
  }

  // 6. Finalize
  refreshed.status = 'completed';
  refreshed.endedAt = new Date();
  refreshed.tags = tags;
  refreshed.coordinateCount = coordCount;
  await refreshed.save();

  logger.info('[route.service] Route completed', {
    userId,
    routeId,
    sessionId,
    coordinateCount: coordCount,
    tags,
  });

  // Emit route.completed event to Redis Stream (non-fatal if Redis is down)
  await emitEvent(STREAMS.ROUTE_EVENTS, {
    type:            'route.completed',
    routeId,
    userId,
    sessionId,
    coordinateCount: String(coordCount),
    timestamp:       new Date().toISOString(),
  });

  // Push SSE event to the user's connected browser clients
  pushToUser(userId, 'route:completed', { routeId, coordinateCount: coordCount });

  return refreshed;
}

// ────────────────────────────────────────────────────────────────
// Get User Routes
// ────────────────────────────────────────────────────────────────

/**
 * Retrieve completed routes for a user.
 * Rule 7.1: Never returns active routes.
 * Rule 2.3: .limit() always applied.
 */
export async function getUserRoutes(userId: string, limit = 50): Promise<IRoute[]> {
  const routes = await Route.find(
    { user_id: userId, status: { $in: ['completed', 'abandoned'] } },
    { 'geometry.coordinates': 0 }, // Exclude large coordinates from list responses
  )
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return routes as unknown as IRoute[];
}

// ────────────────────────────────────────────────────────────────
// Server-Side GPS Filter (Point 2C — improvements.md)
// ────────────────────────────────────────────────────────────────

export interface CoordinateFilterResult {
  accepted: [number, number][];
  rejected: number;
}

/**
 * Server-side coordinate filter applied in addition to the client-side filter.
 * Catches extreme GPS jumps and exact duplicates that slip through.
 *
 * Rule 5.2: haversine > GPS_JUMP_THRESHOLD_METERS → reject (jump).
 * Custom: haversine < 3m → reject (duplicate / no movement).
 *
 * @param rawCoordinates - Incoming [lng, lat] tuples
 * @param lastStored     - Last known accepted coordinate for continuity check
 * @returns { accepted, rejected }
 */
export function filterIncomingCoordinates(
  rawCoordinates: [number, number][],
  lastStored?: [number, number],
): CoordinateFilterResult {
  const threshold = env.GPS_JUMP_THRESHOLD_METERS;
  const DUPLICATE_MIN_METERS = 3;

  const accepted: [number, number][] = [];
  let rejected = 0;
  let prev: [number, number] | undefined = lastStored;

  for (const coord of rawCoordinates) {
    if (!isValidWGS84(coord)) {
      rejected++;
      continue;
    }

    if (prev !== undefined) {
      const dist = haversineDistance(prev, coord);

      // Jump detection (Rule 5.2)
      if (dist > threshold) {
        rejected++;
        logger.debug('[route.service] filterIncomingCoordinates: jump rejected', {
          prev,
          coord,
          distanceMeters: dist,
          threshold,
        });
        continue;
      }

      // Duplicate / stationary detection
      if (dist < DUPLICATE_MIN_METERS) {
        rejected++;
        logger.debug('[route.service] filterIncomingCoordinates: duplicate rejected', {
          coord,
          distanceMeters: dist,
        });
        continue;
      }
    }

    accepted.push(coord);
    prev = coord;
  }

  return { accepted, rejected };
}
