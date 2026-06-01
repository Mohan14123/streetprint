/**
 * src/utils/kalmanFilter.ts
 * GPS Kalman filter — smooths noisy GPS trajectories for display purposes.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CRITICAL RULE (RULES.md §5.3 & improvements.md §2A)           ║
 * ║  Kalman output is DISPLAY ONLY — never stored, never queued.    ║
 * ║  Raw coordinates → motion filter → queue → API                  ║
 * ║  Kalman output  → live map rendering + distance counter only     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface KalmanState {
  lat: number;
  lng: number;
  /** Current estimated variance (m²) */
  variance: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// KalmanGPSFilter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-dimensional Kalman filter applied independently to lat and lng.
 *
 * Model:
 *   Process noise: user may drift `processNoiseMps` m/s between updates.
 *   Measurement noise: GPS `accuracy` (in meters) per reading.
 *
 * Usage:
 *   const kalman = new KalmanGPSFilter();
 *   const smoothed = kalman.filter(lat, lng, accuracy, Date.now());
 *   // DISPLAY ONLY — DO NOT QUEUE
 */
export class KalmanGPSFilter {
  private state: KalmanState | null = null;
  private lastTimestamp: number = 0;

  /**
   * Expected GPS drift in metres per second.
   * A value of 3 m/s works well for pedestrian + vehicle use.
   */
  private readonly processNoiseMps: number;

  constructor(processNoiseMps = 3) {
    this.processNoiseMps = processNoiseMps;
  }

  // ── filter ────────────────────────────────────────────────────────────────

  /**
   * Run one Kalman predict + update step.
   *
   * @param lat       - Raw latitude from GeolocationCoordinates
   * @param lng       - Raw longitude from GeolocationCoordinates
   * @param accuracy  - GeolocationCoordinates.accuracy in meters
   * @param timestamp - Unix milliseconds (Date.now() or coords.timestamp)
   * @returns Smoothed { lat, lng } — DISPLAY ONLY, DO NOT QUEUE
   */
  filter(
    lat: number,
    lng: number,
    accuracy: number,
    timestamp: number,
  ): { lat: number; lng: number } {
    // First call: initialise with measurement directly
    if (this.state === null || this.lastTimestamp === 0) {
      this.state = { lat, lng, variance: accuracy * accuracy };
      this.lastTimestamp = timestamp;
      // DISPLAY ONLY — DO NOT QUEUE
      return { lat, lng };
    }

    // ── Predict step ─────────────────────────────────────────────────────────
    const dtSeconds = Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    const processNoise = this.processNoiseMps * dtSeconds;
    const predictedVariance = this.state.variance + processNoise * processNoise;

    // ── Update step ──────────────────────────────────────────────────────────
    const measurementVariance = accuracy * accuracy;
    const gain = predictedVariance / (predictedVariance + measurementVariance);

    const newLat = this.state.lat + gain * (lat - this.state.lat);
    const newLng = this.state.lng + gain * (lng - this.state.lng);
    const newVariance = (1 - gain) * predictedVariance;

    // Update state
    this.state = { lat: newLat, lng: newLng, variance: newVariance };
    this.lastTimestamp = timestamp;

    // DISPLAY ONLY — DO NOT QUEUE
    return { lat: newLat, lng: newLng };
  }

  // ── reset ─────────────────────────────────────────────────────────────────

  /**
   * Reset the filter state.
   * Must be called at the start and end of each tracking session.
   */
  reset(): void {
    this.state = null;
    this.lastTimestamp = 0;
  }
}
