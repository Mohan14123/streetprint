/**
 * src/services/suggestion.service.ts
 * Unexplored zone detection + popular nearby route suggestions.
 *
 * Rule 3.2: Cache key = suggestions:{userId}:{lat4dp}:{lng4dp}
 * Rule 3.3: TTL = SUGGESTION_CACHE_TTL_SECONDS (default 600)
 * Rule 7.2: Community queries filter isPublic: true.
 * Rule 2.3: All geospatial queries include $maxDistance — no full scans.
 * Rule 5.3: Never simplify routes. previewPolyline = first 20 points.
 * Rule 11: No DB queries in controllers.
 */
import Route from '../models/Route';
import { env } from '../config/env';
import logger from '../config/logger';
import { cacheGet, cacheSet } from '../config/redis';
import {
  getBoundingBox,
  isValidWGS84,
  buildNearQuery,
  type LngLat,
} from '../utils/geoUtils';
import {
  encodePreview,
  decodePolyline,
} from '../utils/polylineEncoder';
import type { SuggestionResult, SuggestionZone, SuggestionRoutePreview } from '../types';
import mongoose from 'mongoose';

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

/** Cell size in meters for the unexplored zone grid */
const GRID_CELL_SIZE_METERS = 200;

/** Maximum popular routes returned */
const MAX_POPULAR_ROUTES = 5;

/** Maximum unexplored zones returned */
const MAX_UNEXPLORED_ZONES = 5;

/** Preview polyline uses first N points */
const PREVIEW_POINT_COUNT = 20;

// ────────────────────────────────────────────────────────────────
// Cache Key Builder
// ────────────────────────────────────────────────────────────────

function buildCacheKey(userId: string, lat: number, lng: number): string {
  const lat4 = lat.toFixed(4);
  const lng4 = lng.toFixed(4);
  return `suggestions:${userId}:${lat4}:${lng4}`;
}

// ────────────────────────────────────────────────────────────────
// Grid Cell Helper
// ────────────────────────────────────────────────────────────────

/**
 * Snap a coordinate to the nearest grid cell center given a cell size in meters.
 * Returns a string key for the cell: "lat_lng".
 */
function snapToGrid(lat: number, lng: number): string {
  // 1 degree lat ≈ 111,320 m; lng degree varies with cos(lat)
  const latStep = GRID_CELL_SIZE_METERS / 111_320;
  const lngStep = GRID_CELL_SIZE_METERS / (111_320 * Math.cos((lat * Math.PI) / 180));

  const snappedLat = Math.round(lat / latStep) * latStep;
  const snappedLng = Math.round(lng / lngStep) * lngStep;

  return `${snappedLat.toFixed(6)}_${snappedLng.toFixed(6)}`;
}

// ────────────────────────────────────────────────────────────────
// Suggestions Service
// ────────────────────────────────────────────────────────────────

/**
 * Generate suggestions for a user at a given location.
 *
 * Returns:
 * - unexploredZones: Grid cells popular in the community but never visited by this user.
 * - popularNearbyRoutes: Top 5 public routes from other users near this location.
 *
 * @param userId - Authenticated user's MongoDB ObjectId string
 * @param lat - User's current latitude
 * @param lng - User's current longitude
 * @param radiusMeters - Search radius (default from PROMPT: 2000 m)
 */
export async function getSuggestions(
  userId: string,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<SuggestionResult> {
  const center: LngLat = [lng, lat];

  if (!isValidWGS84(center)) {
    const err = new Error(`Invalid WGS84 coordinates: lng=${lng}, lat=${lat}`);
    (err as Error & { code: string }).code = 'GPS_INVALID';
    throw err;
  }

  // Cache check
  const cacheKey = buildCacheKey(userId, lat, lng);
  const cached = await cacheGet(cacheKey);

  if (cached) {
    logger.debug('[suggestion.service] Cache hit', { cacheKey });
    return JSON.parse(cached) as SuggestionResult;
  }

  logger.debug('[suggestion.service] Cache miss — computing suggestions', { cacheKey });

  // Run both computations in parallel
  const [unexploredZones, popularNearbyRoutes] = await Promise.all([
    computeUnexploredZones(userId, center, radiusMeters),
    computePopularNearbyRoutes(userId, center, radiusMeters),
  ]);

  const result: SuggestionResult = { unexploredZones, popularNearbyRoutes };

  // Cache result (Rule 3.3: TTL required)
  await cacheSet(cacheKey, JSON.stringify(result), env.SUGGESTION_CACHE_TTL_SECONDS);

  logger.debug('[suggestion.service] Suggestions computed and cached', {
    userId,
    cacheKey,
    unexploredCount: unexploredZones.length,
    popularCount: popularNearbyRoutes.length,
    ttlSeconds: env.SUGGESTION_CACHE_TTL_SECONDS,
  });

  return result;
}

// ────────────────────────────────────────────────────────────────
// Unexplored Zones
// ────────────────────────────────────────────────────────────────

/**
 * Identify grid cells within radius that:
 * - Have community coverage (other users have routes there)
 * - Have zero coverage by this user
 */
async function computeUnexploredZones(
  userId: string,
  center: LngLat,
  radiusMeters: number,
): Promise<SuggestionZone[]> {
  const [minLng, minLat, maxLng, maxLat] = getBoundingBox(center, radiusMeters);

  // Get all public completed routes in the bounding box (community routes)
  const communityRoutes = await Route.find(
    {
      status: 'completed',
      isPublic: true,
      isPolylineEncoded: false, // Skip encoded for grid computation
      geometry: {
        $geoWithin: {
          $box: [[minLng, minLat], [maxLng, maxLat]],
        },
      },
    },
    { 'geometry.coordinates': 1, _id: 0 },
  )
    .limit(500)
    .lean();

  // Get this user's completed routes in the bounding box
  const userRoutes = await Route.find(
    {
      user_id: userId,
      status: 'completed',
      isPolylineEncoded: false,
      geometry: {
        $geoWithin: {
          $box: [[minLng, minLat], [maxLng, maxLat]],
        },
      },
    },
    { 'geometry.coordinates': 1, _id: 0 },
  )
    .limit(500)
    .lean();

  // Build grid coverage sets
  const communityGrid = new Set<string>();
  const userGrid = new Set<string>();

  for (const route of communityRoutes) {
    for (const coord of route.geometry.coordinates) {
      const [cLng, cLat] = coord as [number, number];
      communityGrid.add(snapToGrid(cLat, cLng));
    }
  }

  for (const route of userRoutes) {
    for (const coord of route.geometry.coordinates) {
      const [cLng, cLat] = coord as [number, number];
      userGrid.add(snapToGrid(cLat, cLng));
    }
  }

  // Find cells in community coverage but NOT in user coverage
  const unexploredCells = [...communityGrid].filter((cell) => !userGrid.has(cell));

  // Convert grid cell keys back to GeoJSON Points
  const zones: SuggestionZone[] = unexploredCells
    .slice(0, MAX_UNEXPLORED_ZONES)
    .map((cell): SuggestionZone => {
      const [cLat, cLng] = cell.split('_').map(Number);
      return {
        type: 'Point',
        coordinates: [cLng, cLat], // GeoJSON [lng, lat]
      };
    });

  return zones;
}

// ────────────────────────────────────────────────────────────────
// Popular Nearby Routes
// ────────────────────────────────────────────────────────────────

/**
 * Find top 5 public routes from OTHER users that pass within radiusMeters of the center.
 * Ranked by coordinateCount descending (longer = more explored = more popular).
 * Returns metadata only — no full coordinate dump (Rule 7.1 & privacy).
 */
async function computePopularNearbyRoutes(
  userId: string,
  center: LngLat,
  radiusMeters: number,
): Promise<SuggestionRoutePreview[]> {
  const nearQuery = buildNearQuery(center, radiusMeters);

  const routes = await Route.find(
    {
      user_id: { $ne: new mongoose.Types.ObjectId(userId) }, // Exclude this user's routes
      status: 'completed',
      isPublic: true,
      geometry: nearQuery,
    },
    {
      sessionId: 0, // Don't expose internal session IDs
      user_id: 0,
    },
  )
    .sort({ coordinateCount: -1 })
    .limit(MAX_POPULAR_ROUTES)
    .lean();

  return routes.map((route): SuggestionRoutePreview => {
    // Get coordinates — decode if polyline-encoded (Rule 5.5)
    let coordinates: [number, number][];

    if (route.isPolylineEncoded && route.geometry.coordinates.length > 0) {
      coordinates = decodePolyline(route.geometry.coordinates[0] as unknown as string);
    } else {
      coordinates = route.geometry.coordinates as [number, number][];
    }

    return {
      routeId: route._id as mongoose.Types.ObjectId,
      startedAt: route.startedAt,
      coordinateCount: route.coordinateCount,
      tags: route.tags,
      // Rule 5.3: preview = first 20 points, not a simplification of the whole route
      previewPolyline: encodePreview(coordinates, PREVIEW_POINT_COUNT),
    };
  });
}
