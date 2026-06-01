/**
 * src/utils/geoUtils.ts
 * Pure geospatial utility functions — no side effects, no DB/logger imports.
 * Rule 5.1: All coordinates are [lng, lat] — GeoJSON standard.
 * Rule 5.2: GPS noise filtering — reject jumps > GPS_JUMP_THRESHOLD_METERS silently.
 * Rule 5.3: Never simplify routes — these utils are for filtering and querying only.
 * Rule 11: All utility functions must be pure.
 */

/** Coordinate pair: [longitude, latitude] — always GeoJSON order */
export type LngLat = [number, number];

/** MongoDB $geoWithin box query shape */
export interface GeoWithinBox {
  $geoWithin: {
    $box: [[number, number], [number, number]];
  };
}

/** MongoDB $nearSphere query shape */
export interface GeoNearSphere {
  $nearSphere: {
    $geometry: { type: 'Point'; coordinates: LngLat };
    $maxDistance: number;
  };
}

// ────────────────────────────────────────────────────────────────
// Haversine Distance
// ────────────────────────────────────────────────────────────────

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Calculate the great-circle distance between two [lng, lat] points in meters.
 * Uses the Haversine formula.
 *
 * @param a - [longitude, latitude] of point A
 * @param b - [longitude, latitude] of point B
 * @returns Distance in meters
 */
export function haversineDistance(a: LngLat, b: LngLat): number {
  const [lngA, latA] = a;
  const [lngB, latB] = b;

  const φ1 = (latA * Math.PI) / 180;
  const φ2 = (latB * Math.PI) / 180;
  const Δφ = ((latB - latA) * Math.PI) / 180;
  const Δλ = ((lngB - lngA) * Math.PI) / 180;

  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);

  const a2 =
    sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;

  const c = 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));

  return EARTH_RADIUS_METERS * c;
}

// ────────────────────────────────────────────────────────────────
// GPS Noise Filter
// ────────────────────────────────────────────────────────────────

/**
 * Determine whether a new GPS coordinate is valid given the previous coordinate.
 *
 * Rule 5.2: Reject if distance from prev → next exceeds `thresholdMeters`.
 * - Returns `true` if the point is valid and should be accepted.
 * - Returns `false` if it is a noisy outlier and should be silently rejected.
 *
 * The caller is responsible for logging rejected points at DEBUG level:
 *   `{ routeId, sessionId, rejectedCoord, distanceMeters }`
 * This function is pure and does not log.
 *
 * @param prev - Previous accepted [lng, lat]
 * @param next - Incoming [lng, lat] to validate
 * @param thresholdMeters - Maximum allowed jump distance (default: 500m per rules.md)
 */
export function filterNoisyPoint(
  prev: LngLat,
  next: LngLat,
  thresholdMeters = 500,
): boolean {
  const distance = haversineDistance(prev, next);
  return distance <= thresholdMeters;
}

// ────────────────────────────────────────────────────────────────
// Coordinate Validation
// ────────────────────────────────────────────────────────────────

/**
 * Validate that a coordinate pair satisfies WGS84 bounds.
 * Rule 5.1: lng ∈ [-180, 180], lat ∈ [-90, 90].
 *
 * @param coord - [longitude, latitude]
 * @returns true if valid
 */
export function isValidWGS84(coord: LngLat): boolean {
  const [lng, lat] = coord;
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

/**
 * Validate a full coordinate tuple including an optional timestamp.
 * Used when processing /route/update body coordinates: [lng, lat, timestamp].
 */
export function isValidCoordTuple(coord: unknown): coord is [number, number, number] {
  if (!Array.isArray(coord)) return false;
  if (coord.length < 2 || coord.length > 3) return false;
  const [lng, lat] = coord as number[];
  return (
    typeof lng === 'number' &&
    typeof lat === 'number' &&
    isValidWGS84([lng, lat])
  );
}

// ────────────────────────────────────────────────────────────────
// Bounds Parser
// ────────────────────────────────────────────────────────────────

/**
 * Parse a `?bounds=minLng,minLat,maxLng,maxLat` query string value
 * into a MongoDB `$geoWithin` box query ready to be used on a geometry field.
 *
 * Rule 2.3: All geospatial queries must include $geoWithin or $near + $maxDistance.
 *
 * @param boundsString - Comma-separated string: "minLng,minLat,maxLng,maxLat"
 * @returns MongoDB $geoWithin box query object
 * @throws Error if the string is malformed or out of WGS84 bounds
 */
export function parseBounds(boundsString: string): GeoWithinBox {
  const parts = boundsString.split(',').map(Number);

  if (parts.length !== 4 || parts.some(isNaN)) {
    throw new Error(
      `Invalid bounds format. Expected "minLng,minLat,maxLng,maxLat", got: "${boundsString}"`,
    );
  }

  const [minLng, minLat, maxLng, maxLat] = parts;

  if (!isValidWGS84([minLng, minLat]) || !isValidWGS84([maxLng, maxLat])) {
    throw new Error(
      `Bounds coordinates are out of WGS84 range: minLng=${minLng}, minLat=${minLat}, maxLng=${maxLng}, maxLat=${maxLat}`,
    );
  }

  if (minLng >= maxLng || minLat >= maxLat) {
    throw new Error(
      `Bounds are inverted: min values must be less than max values.`,
    );
  }

  return {
    $geoWithin: {
      $box: [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Near Query Builder
// ────────────────────────────────────────────────────────────────

/**
 * Build a MongoDB $nearSphere query for proximity-based lookups.
 * Rule 2.3: Always include $maxDistance to prevent full collection scans.
 *
 * @param center - [longitude, latitude] of the center point
 * @param maxDistanceMeters - Maximum search radius in meters
 */
export function buildNearQuery(center: LngLat, maxDistanceMeters: number): GeoNearSphere {
  return {
    $nearSphere: {
      $geometry: {
        type: 'Point',
        coordinates: center,
      },
      $maxDistance: maxDistanceMeters,
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Bounding Box Generator
// ────────────────────────────────────────────────────────────────

/**
 * Compute a bounding box around a center point given a radius.
 * Returns [minLng, minLat, maxLng, maxLat].
 *
 * Approximation: 1 degree latitude ≈ 111,320 meters.
 * Used by: suggestion.service.ts for grid cell computation.
 */
export function getBoundingBox(
  center: LngLat,
  radiusMeters: number,
): [number, number, number, number] {
  const [lng, lat] = center;

  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));

  return [
    Math.max(-180, lng - lngDelta),
    Math.max(-90, lat - latDelta),
    Math.min(180, lng + lngDelta),
    Math.min(90, lat + latDelta),
  ];
}

// ────────────────────────────────────────────────────────────────
// Bounds Hash (for cache keys)
// ────────────────────────────────────────────────────────────────

/**
 * Generate a deterministic hash string from bounds for use in Redis cache keys.
 * Rule 3.2: Cache keys must be namespaced — this provides the `{boundsHash}` token.
 * Rounds to 4 decimal places (≈ 11m precision) to improve cache hit rate.
 */
export function hashBounds(minLng: number, minLat: number, maxLng: number, maxLat: number): string {
  const round = (n: number): string => n.toFixed(4);
  return `${round(minLng)}_${round(minLat)}_${round(maxLng)}_${round(maxLat)}`;
}
