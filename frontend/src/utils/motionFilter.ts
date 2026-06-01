/**
 * src/utils/motionFilter.ts
 * Client-side motion-triggered GPS filter.
 *
 * shouldAcceptPoint() decides whether an incoming GPS reading should be queued.
 * Filters out: low-accuracy readings, too-frequent updates, and stationary readings.
 *
 * Config is read from VITE_* env variables with fallbacks (Rule 10.3).
 * resetMotionFilter() must be called at the start and end of each session.
 *
 * This filter operates on RAW coordinates (never Kalman-smoothed output).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Haversine distance (pure, no imports needed — keeps utils self-contained)
// ─────────────────────────────────────────────────────────────────────────────

function haversineDistance(a: [number, number], b: [number, number]): number {
  const EARTH_RADIUS_METERS = 6_371_000;
  const [lngA, latA] = a;
  const [lngB, latB] = b;

  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const φ1 = toRad(latA);
  const φ2 = toRad(latB);
  const Δφ = toRad(latB - latA);
  const Δλ = toRad(lngB - lngA);

  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);

  const a2 = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Config — from env with fallbacks
// ─────────────────────────────────────────────────────────────────────────────

function envNum(key: string, fallback: number): number {
  const raw = (import.meta as { env?: Record<string, string> }).env?.[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return isNaN(parsed) ? fallback : parsed;
}

const MIN_DISTANCE_METERS = envNum('VITE_MIN_DIST_M', 8);
const MIN_INTERVAL_MS = envNum('VITE_MIN_INTERVAL_MS', 2_000);
const MAX_ACCURACY_METERS = envNum('VITE_MAX_ACCURACY_M', 25);

// ─────────────────────────────────────────────────────────────────────────────
// Filter state — module-level (reset between sessions)
// ─────────────────────────────────────────────────────────────────────────────

let lastAcceptedCoord: [number, number] | null = null;
let lastAcceptedTime = 0;

// ─────────────────────────────────────────────────────────────────────────────
// shouldAcceptPoint
// ─────────────────────────────────────────────────────────────────────────────

export interface FilterResult {
  accept: boolean;
  reason?: 'low_accuracy' | 'too_frequent' | 'no_movement';
}

/**
 * Decide whether a raw GPS coordinate should be accepted for queueing.
 *
 * Rejection reasons:
 *   low_accuracy — GPS signal too noisy (accuracy > MAX_ACCURACY_METERS)
 *   too_frequent — update interval too short (< MIN_INTERVAL_MS)
 *   no_movement  — distance from last accepted coord < MIN_DISTANCE_METERS
 *
 * When accept=true: updates lastAcceptedCoord and lastAcceptedTime.
 *
 * @param coord     - Raw [lng, lat] — NEVER pass Kalman-smoothed coords here
 * @param accuracy  - GeolocationCoordinates.accuracy in meters
 * @param timestamp - Unix milliseconds
 */
export function shouldAcceptPoint(
  coord: [number, number],
  accuracy: number,
  timestamp: number,
): FilterResult {
  // 1. Accuracy gate
  if (accuracy > MAX_ACCURACY_METERS) {
    return { accept: false, reason: 'low_accuracy' };
  }

  // 2. Time gate
  if (lastAcceptedTime !== 0 && timestamp - lastAcceptedTime < MIN_INTERVAL_MS) {
    return { accept: false, reason: 'too_frequent' };
  }

  // 3. Distance gate
  if (lastAcceptedCoord !== null) {
    const dist = haversineDistance(lastAcceptedCoord, coord);
    if (dist < MIN_DISTANCE_METERS) {
      return { accept: false, reason: 'no_movement' };
    }
  }

  // Accepted — update state
  lastAcceptedCoord = coord;
  lastAcceptedTime = timestamp;
  return { accept: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// resetMotionFilter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clear the filter's internal state.
 * Must be called at startTracking() and stopTracking() to prevent
 * stale state from leaking between sessions.
 */
export function resetMotionFilter(): void {
  lastAcceptedCoord = null;
  lastAcceptedTime = 0;
}
