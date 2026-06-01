/**
 * src/offline/syncEngine.ts
 * Bidirectional sync engine — pushes local IndexedDB state to the API.
 *
 * SyncEngine.syncAll() runs three flows sequentially:
 *   1. syncPendingCoordinates() → POST /route/update
 *   2. syncPendingPlaces()      → POST /places/save
 *   3. syncPendingVisibilityChanges() → PATCH /route/:id/visibility
 *
 * Individual flow failures must NOT stop the other flows (each in its own try/catch).
 * startAutoSync() registers for window 'online' and Background Sync API.
 * stopAutoSync() cleans up the event listener.
 */
import {
  getPendingBatches,
  markBatchFlushed,
  getPendingPlaces,
  markPlaceSynced,
  getPendingVisibilityChanges,
  markVisibilitySynced,
} from './localDb';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncResult {
  coordinatesSynced: number;
  placesSynced: number;
  visibilitySynced: number;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// API base URL — read from Vite env at build-time
// In dev (VITE_API_URL=''), we use '/api' so requests go through the Vite proxy.
// In prod, VITE_API_URL is the deployed backend URL.
// ─────────────────────────────────────────────────────────────────────────────

const VITE_API_URL =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL) ||
  '';

const API_URL = VITE_API_URL ? `${VITE_API_URL}/api` : '/api';

/** Build headers with auth token from localStorage */
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('rm_access_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ─────────────────────────────────────────────────────────────────────────────
// SyncEngine
// ─────────────────────────────────────────────────────────────────────────────

export class SyncEngine {
  private onlineHandler: (() => void) | null = null;

  // ── syncAll ──────────────────────────────────────────────────────────────

  /**
   * Run all three sync flows sequentially.
   * Failures in individual flows are captured — they do not stop subsequent flows.
   */
  async syncAll(): Promise<SyncResult> {
    const result: SyncResult = {
      coordinatesSynced: 0,
      placesSynced: 0,
      visibilitySynced: 0,
      errors: [],
    };

    // 1. Coordinates
    try {
      result.coordinatesSynced = await this.syncPendingCoordinates();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`coordinates: ${msg}`);
    }

    // 2. Places
    try {
      result.placesSynced = await this.syncPendingPlaces();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`places: ${msg}`);
    }

    // 3. Visibility
    try {
      result.visibilitySynced = await this.syncPendingVisibilityChanges();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`visibility: ${msg}`);
    }

    if (result.errors.length > 0) {
      console.info('[syncEngine] syncAll completed with errors', result);
    } else {
      console.info('[syncEngine] syncAll completed successfully', result);
    }

    return result;
  }

  // ── syncPendingCoordinates ───────────────────────────────────────────────

  /**
   * POST each unflushed coordinate batch to /route/update.
   * On success: markBatchFlushed(key).
   * On individual failure: log and continue — do not throw.
   * @returns Number of batches successfully synced
   */
  async syncPendingCoordinates(): Promise<number> {
    const batches = await getPendingBatches();
    let synced = 0;

    for (const batch of batches) {
      try {
        const response = await fetch(`${API_URL}/route/update`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            sessionId: batch.sessionId,
            coordinates: batch.coordinates,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          console.warn('[syncEngine] syncPendingCoordinates batch rejected', {
            routeId: batch.routeId,
            status: response.status,
            body: text,
          });
          continue;
        }

        await markBatchFlushed(batch.key);
        synced++;
      } catch (err) {
        // Network failure — log and continue, leave batch in IndexedDB
        console.warn('[syncEngine] syncPendingCoordinates batch error', {
          routeId: batch.routeId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return synced;
  }

  // ── syncPendingPlaces ────────────────────────────────────────────────────

  /**
   * POST each unsynced place to /places/save.
   * On success: markPlaceSynced(localId).
   * On individual failure: log and continue.
   * @returns Number of places successfully synced
   */
  async syncPendingPlaces(): Promise<number> {
    const places = await getPendingPlaces();
    let synced = 0;

    for (const place of places) {
      try {
        const response = await fetch(`${API_URL}/places/save`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            label: place.label,
            lat: place.lat,
            lng: place.lng,
            notes: place.notes,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          console.warn('[syncEngine] syncPendingPlaces place rejected', {
            localId: place.localId,
            status: response.status,
            body: text,
          });
          continue;
        }

        await markPlaceSynced(place.localId);
        synced++;
      } catch (err) {
        console.warn('[syncEngine] syncPendingPlaces place error', {
          localId: place.localId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return synced;
  }

  // ── syncPendingVisibilityChanges ─────────────────────────────────────────

  /**
   * PATCH each unsynced visibility change to /route/:routeId/visibility.
   * On success: markVisibilitySynced(routeId).
   * On individual failure: log and continue.
   * @returns Number of visibility changes successfully synced
   */
  async syncPendingVisibilityChanges(): Promise<number> {
    const changes = await getPendingVisibilityChanges();
    let synced = 0;

    for (const change of changes) {
      try {
        const response = await fetch(
          `${API_URL}/route/${change.routeId}/visibility`,
          {
            method: 'PATCH',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({ isPublic: change.isPublic }),
          },
        );

        if (!response.ok) {
          const text = await response.text();
          console.warn('[syncEngine] visibility change rejected', {
            routeId: change.routeId,
            status: response.status,
            body: text,
          });
          continue;
        }

        await markVisibilitySynced(change.routeId);
        synced++;
      } catch (err) {
        console.warn('[syncEngine] visibility change error', {
          routeId: change.routeId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return synced;
  }

  // ── startAutoSync ────────────────────────────────────────────────────────

  /**
   * Register auto-sync triggers:
   *   1. window 'online' event → run syncAll() immediately on reconnect
   *   2. Background Sync API (if service worker supported)
   *
   * Call on app mount.
   */
  async startAutoSync(): Promise<void> {
    // 1. Online event listener
    this.onlineHandler = () => {
      console.info('[syncEngine] Network came online — triggering sync');
      void this.syncAll().then((result) => {
        console.info('[syncEngine] Auto-sync on reconnect result', result);
      });
    };
    window.addEventListener('online', this.onlineHandler);

    // 2. Background Sync API
    try {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        // The Background Sync API typing is not always present — use type assertion
        const syncManager = (
          reg as ServiceWorkerRegistration & {
            sync: { register(tag: string): Promise<void> };
          }
        ).sync;
        await syncManager.register('route-memory-sync');
        console.info('[syncEngine] Background Sync registered');
      }
    } catch (err) {
      // Non-fatal — Background Sync is a progressive enhancement.
      // NotAllowedError occurs when the browser denies Background Sync
      // (incognito mode, unsupported browser, permission denied, etc.)
      const errName = err instanceof Error ? err.name : '';
      if (errName === 'NotAllowedError' || errName === 'InvalidStateError') {
        // Silently ignore — these are expected in many environments
        console.debug('[syncEngine] Background Sync denied by browser (non-fatal)');
      } else {
        console.debug('[syncEngine] Background Sync not available (non-fatal)', err);
      }
    }
  }

  // ── stopAutoSync ─────────────────────────────────────────────────────────

  /**
   * Remove the online event listener.
   * Call on app unmount.
   */
  stopAutoSync(): void {
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
  }
}

// Singleton instance for use across the app
export const syncEngine = new SyncEngine();
