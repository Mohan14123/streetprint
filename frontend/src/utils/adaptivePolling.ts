/**
 * src/utils/adaptivePolling.ts
 * Adaptive GPS polling — dynamically adjusts watchPosition parameters
 * based on the user's detected motion state to save battery.
 *
 * All interval/accuracy values read from import.meta.env with sensible fallbacks
 * (Rule 10.3: No hardcoded values).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Motion States
// ─────────────────────────────────────────────────────────────────────────────

export type MotionState = 'stationary' | 'walking' | 'running' | 'vehicle';

// ─────────────────────────────────────────────────────────────────────────────
// Motion Profiles — read from env with fallbacks
// ─────────────────────────────────────────────────────────────────────────────

export interface MotionProfile {
  /** Target update interval in milliseconds (used as maximumAge) */
  intervalMs: number;
  /** Reject readings with accuracy worse than this (meters) */
  maxAccuracyMeters: number;
  /** Whether to request high-accuracy mode (GNSS) from the device */
  enableHighAccuracy: boolean;
}

function envNum(key: string, fallback: number): number {
  const raw = (import.meta as { env?: Record<string, string> }).env?.[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return isNaN(parsed) ? fallback : parsed;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = (import.meta as { env?: Record<string, string> }).env?.[key];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true';
}

/**
 * MOTION_PROFILES — per-state watchPosition configuration.
 * All values are read from VITE_* env variables with safe fallbacks.
 */
export const MOTION_PROFILES: Record<MotionState, MotionProfile> = {
  stationary: {
    intervalMs: envNum('VITE_POLL_STATIONARY_MS', 30_000),
    maxAccuracyMeters: envNum('VITE_ACCURACY_STATIONARY_M', 50),
    enableHighAccuracy: envBool('VITE_HIGH_ACC_STATIONARY', false),
  },
  walking: {
    intervalMs: envNum('VITE_POLL_WALKING_MS', 5_000),
    maxAccuracyMeters: envNum('VITE_ACCURACY_WALKING_M', 20),
    enableHighAccuracy: envBool('VITE_HIGH_ACC_WALKING', true),
  },
  running: {
    intervalMs: envNum('VITE_POLL_RUNNING_MS', 2_000),
    maxAccuracyMeters: envNum('VITE_ACCURACY_RUNNING_M', 15),
    enableHighAccuracy: envBool('VITE_HIGH_ACC_RUNNING', true),
  },
  vehicle: {
    intervalMs: envNum('VITE_POLL_VEHICLE_MS', 1_000),
    maxAccuracyMeters: envNum('VITE_ACCURACY_VEHICLE_M', 10),
    enableHighAccuracy: envBool('VITE_HIGH_ACC_VEHICLE', true),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// detectMotionState
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect the user's current motion state from GPS speed or distance.
 *
 * Most browsers do not provide coords.speed reliably.
 * When speedMps is null: infer from distance covered since last accepted coord.
 *
 * Speed thresholds (m/s):
 *   < 0.5  → stationary
 *   < 2.0  → walking
 *   < 6.0  → running
 *   else   → vehicle
 *
 * Distance thresholds (meters, when speed unavailable):
 *   < 2   → stationary
 *   < 15  → walking
 *   < 40  → running
 *   else  → vehicle
 *
 * @param speedMps             - GeolocationCoordinates.speed or null
 * @param distanceFromLastMeters - Haversine distance from last accepted coord
 */
export function detectMotionState(
  speedMps: number | null,
  distanceFromLastMeters: number,
): MotionState {
  if (speedMps !== null) {
    if (speedMps < 0.5) return 'stationary';
    if (speedMps < 2.0) return 'walking';
    if (speedMps < 6.0) return 'running';
    return 'vehicle';
  }

  // Infer from distance covered when speed is unavailable
  if (distanceFromLastMeters < 2) return 'stationary';
  if (distanceFromLastMeters < 15) return 'walking';
  if (distanceFromLastMeters < 40) return 'running';
  return 'vehicle';
}
