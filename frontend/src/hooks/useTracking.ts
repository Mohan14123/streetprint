/**
 * src/hooks/useTracking.ts
 * GPS tracking hook — integrates Kalman filter, adaptive polling,
 * motion filter, and offline-first IndexedDB write flow.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  COORDINATE FLOW                                                          ║
 * ║  Raw GPS → motionFilter.shouldAcceptPoint() → queueCoordinateBatch()     ║
 * ║                                            → IndexedDB                   ║
 * ║                                            → syncEngine (if online)      ║
 * ║                                                                           ║
 * ║  Kalman output → updateLiveRouteOnMap()  ← DISPLAY ONLY — DO NOT QUEUE  ║
 * ║                → updateRunningDistance() ← DISPLAY ONLY — DO NOT QUEUE  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Rules enforced:
 *   RULES.md §5.1: Coordinates stored as [lng, lat] — GeoJSON order
 *   RULES.md §5.3: Raw coordinates only; never simplify or smooth before storage
 *   improvements.md §2A: Kalman output never queued
 */
import { useState, useRef, useCallback } from 'react';
import { nanoid } from 'nanoid';
import { KalmanGPSFilter } from '../utils/kalmanFilter';
import {
  detectMotionState,
  MOTION_PROFILES,
  type MotionProfile,
  type MotionState,
} from '../utils/adaptivePolling';
import { shouldAcceptPoint, resetMotionFilter } from '../utils/motionFilter';
import { queueCoordinateBatch } from '../offline/localDb';
import { syncEngine } from '../offline/syncEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TrackingState {
  isTracking: boolean;
  routeId: string | null;
  sessionId: string | null;
  /** Live polyline coordinates — Kalman-smoothed, DISPLAY ONLY */
  liveRoute: [number, number][];
  /** Running distance in meters — computed from Kalman coords, DISPLAY ONLY */
  distanceMeters: number;
  currentMotionState: MotionState;
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Haversine distance (for distance counter — uses smoothed coords)
// ─────────────────────────────────────────────────────────────────────────────

function haversineDistance(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lngA, latA] = a;
  const [lngB, latB] = b;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a2 =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));
}

// ─────────────────────────────────────────────────────────────────────────────
// useTracking hook
// ─────────────────────────────────────────────────────────────────────────────

const API_URL =
  (import.meta as { env?: Record<string, string> }).env?.['VITE_API_URL'] ??
  'http://localhost:3000';

export function useTracking() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [state, setState] = useState<TrackingState>({
    isTracking: false,
    routeId: null,
    sessionId: null,
    liveRoute: [],
    distanceMeters: 0,
    currentMotionState: 'walking',
    error: null,
  });

  // ── Refs ───────────────────────────────────────────────────────────────────
  const watchIdRef = useRef<number | null>(null);
  const kalman = useRef(new KalmanGPSFilter());
  const pendingRawCoordsRef = useRef<[number, number][]>([]);
  const pendingMotionStatesRef = useRef<string[]>([]);
  const currentProfileRef = useRef<MotionProfile>(MOTION_PROFILES.walking);
  const lastSmoothedCoordRef = useRef<[number, number] | null>(null);
  const routeIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // ── restartWatch ──────────────────────────────────────────────────────────

  const restartWatch = useCallback(
    (profile: MotionProfile, onPosition: PositionCallback, onError: PositionErrorCallback) => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, {
        enableHighAccuracy: profile.enableHighAccuracy,
        maximumAge: profile.intervalMs,
        timeout: 10_000,
      });
    },
    [],
  );

  // ── flushPendingBatch ─────────────────────────────────────────────────────

  /**
   * Write the accumulated raw coordinate buffer to IndexedDB (offline-first).
   * If online: immediately attempt to sync to the API.
   */
  const flushPendingBatch = useCallback(async () => {
    const coords = pendingRawCoordsRef.current.slice();
    const motions = pendingMotionStatesRef.current.slice();
    pendingRawCoordsRef.current = [];
    pendingMotionStatesRef.current = [];

    if (coords.length === 0 || !routeIdRef.current || !sessionIdRef.current) return;

    // AFTER: raw coords → IndexedDB first (offline-first)
    await queueCoordinateBatch({
      routeId: routeIdRef.current,
      sessionId: sessionIdRef.current,
      coordinates: coords,           // Raw coordinates — never Kalman output
      motionStates: motions,
      timestamp: Date.now(),
      flushed: false,
    });

    // If online: attempt immediate sync
    if (navigator.onLine) {
      void syncEngine.syncPendingCoordinates();
    }
    // If offline: leave in IndexedDB, auto-sync on reconnect (SyncEngine.startAutoSync)
  }, []);

  // ── onPosition ─────────────────────────────────────────────────────────────

  const onPositionRef = useRef<PositionCallback | null>(null);
  const onErrorRef = useRef<PositionErrorCallback | null>(null);

  const buildPositionHandler = useCallback((): PositionCallback => {
    return (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;
      const timestamp = pos.timestamp;
      const speed = pos.coords.speed;

      // ── 1. Adaptive polling ───────────────────────────────────────────────
      const lastSmoothed = lastSmoothedCoordRef.current;
      const distFromLast = lastSmoothed
        ? haversineDistance(lastSmoothed, [lng, lat])
        : 0;

      const newMotionState = detectMotionState(speed, distFromLast);
      const newProfile = MOTION_PROFILES[newMotionState];

      if (newProfile.intervalMs !== currentProfileRef.current.intervalMs) {
        currentProfileRef.current = newProfile;
        setState((s) => ({ ...s, currentMotionState: newMotionState }));

        // Restart the watch with the new profile
        if (onPositionRef.current && onErrorRef.current) {
          restartWatch(newProfile, onPositionRef.current, onErrorRef.current);
        }
        return; // new watch fires fresh — skip this stale event
      }

      // ── 2. Accuracy gate (adaptive profile) ──────────────────────────────
      if (accuracy > newProfile.maxAccuracyMeters) return;

      // ── 3. Raw coordinate — motion filter → queue ─────────────────────────
      const rawCoord: [number, number] = [lng, lat]; // GeoJSON [lng, lat]
      const filterResult = shouldAcceptPoint(rawCoord, accuracy, timestamp);

      if (filterResult.accept) {
        // Raw → buffer → IndexedDB → API (never smoothed coords)
        pendingRawCoordsRef.current.push(rawCoord);
        pendingMotionStatesRef.current.push(newMotionState);

        // Flush every 5 accepted coords
        if (pendingRawCoordsRef.current.length >= 5) {
          void flushPendingBatch();
        }
      }

      // ── 4. Kalman filter → display only ──────────────────────────────────
      // DISPLAY ONLY — DO NOT QUEUE
      const smoothed = kalman.current.filter(lat, lng, accuracy, timestamp);
      const smoothedCoord: [number, number] = [smoothed.lng, smoothed.lat];
      lastSmoothedCoordRef.current = smoothedCoord;

      // Update live route display (Kalman output — DISPLAY ONLY, DO NOT QUEUE)
      setState((s) => {
        const prevSmoothed = s.liveRoute[s.liveRoute.length - 1];
        const addedDist = prevSmoothed
          ? haversineDistance(prevSmoothed, smoothedCoord)
          : 0;
        return {
          ...s,
          liveRoute: [...s.liveRoute, smoothedCoord], // DISPLAY ONLY — DO NOT QUEUE
          distanceMeters: s.distanceMeters + addedDist, // DISPLAY ONLY — DO NOT QUEUE
          currentMotionState: newMotionState,
        };
      });
    };
  }, [flushPendingBatch, restartWatch]);

  // ── startTracking ─────────────────────────────────────────────────────────

  const startTracking = useCallback(async () => {
    if (!navigator.geolocation) {
      setState((s) => ({ ...s, error: 'Geolocation not supported' }));
      return;
    }

    // Reset all state for a fresh session
    kalman.current.reset();
    resetMotionFilter();
    pendingRawCoordsRef.current = [];
    pendingMotionStatesRef.current = [];
    lastSmoothedCoordRef.current = null;
    currentProfileRef.current = MOTION_PROFILES.walking;

    // Create backend session
    let routeId: string | null = null;
    let sessionId: string | null = null;

    try {
      const resp = await fetch(`${API_URL}/route/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          data: { routeId: string; sessionId: string };
        };
        routeId = data.data.routeId;
        sessionId = data.data.sessionId;
      }
    } catch {
      // Offline: generate local IDs — will reconcile on sync
      routeId = `local_${nanoid()}`;
      sessionId = nanoid();
    }

    routeIdRef.current = routeId;
    sessionIdRef.current = sessionId;

    setState((s) => ({
      ...s,
      isTracking: true,
      routeId,
      sessionId,
      liveRoute: [],
      distanceMeters: 0,
      currentMotionState: 'walking',
      error: null,
    }));

    // Build position handler and start watching
    const posHandler = buildPositionHandler();
    const errHandler: PositionErrorCallback = (err) => {
      setState((s) => ({ ...s, error: `GPS error: ${err.message}` }));
    };
    onPositionRef.current = posHandler;
    onErrorRef.current = errHandler;

    restartWatch(MOTION_PROFILES.walking, posHandler, errHandler);
  }, [buildPositionHandler, restartWatch]);

  // ── stopTracking ──────────────────────────────────────────────────────────

  const stopTracking = useCallback(async () => {
    // Stop the geolocation watch
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    // Flush remaining buffer before ending the session
    await flushPendingBatch();

    // Reset filter state
    kalman.current.reset();
    resetMotionFilter();

    // End session on the backend
    if (routeIdRef.current && sessionIdRef.current) {
      try {
        await fetch(`${API_URL}/route/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sessionId: sessionIdRef.current }),
        });
      } catch {
        // Offline — session end will be retried on next sync
      }
    }

    setState((s) => ({ ...s, isTracking: false, sessionId: null }));
  }, [flushPendingBatch]);

  // ── savePlace ─────────────────────────────────────────────────────────────

  /**
   * Queue a place to IndexedDB (offline-first), then sync if online.
   */
  const savePlace = useCallback(
    async (label: string, lat: number, lng: number, notes?: string) => {
      const { queuePlace } = await import('../offline/localDb');
      await queuePlace({
        localId: nanoid(),
        label,
        lat,
        lng,
        notes,
        timestamp: Date.now(),
        synced: false,
      });

      if (navigator.onLine) {
        void syncEngine.syncPendingPlaces();
      }
    },
    [],
  );

  return { state, startTracking, stopTracking, savePlace };
}
