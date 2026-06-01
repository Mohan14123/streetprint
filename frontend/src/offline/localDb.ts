/**
 * src/offline/localDb.ts
 * IndexedDB local database — offline-first single source of truth.
 *
 * Three object stores:
 *   - pending_routes          : coordinate batches queued for sync
 *   - pending_places          : places queued for sync
 *   - pending_visibility_changes : visibility toggles queued for sync
 *   - conflict_log            : debugging log for resolved conflicts
 *
 * All IndexedDB operations are wrapped in try/catch.
 * On failure: log the error, do NOT crash the tracking session.
 */
import { openDB, IDBPDatabase } from 'idb';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingRouteBatch {
  routeId: string;
  sessionId: string;
  coordinates: [number, number][];
  motionStates: string[];
  timestamp: number;
  flushed: boolean;
}

export interface PendingPlace {
  localId: string;
  label: string;
  lat: number;
  lng: number;
  notes?: string;
  timestamp: number;
  synced: boolean;
}

export interface PendingVisibilityChange {
  routeId: string;
  isPublic: boolean;
  timestamp: number;
  synced: boolean;
}

export interface ConflictLogEntry {
  localValue: unknown;
  remoteValue: unknown;
  resolution: unknown;
  timestamp: number;
  entityType: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB Schema
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'route-memory-offline';
const DB_VERSION = 1;

type LocalDb = IDBPDatabase<{
  pending_routes: {
    key: number;
    value: PendingRouteBatch & { key?: number };
    indexes: { by_flushed: boolean };
  };
  pending_places: {
    key: number;
    value: PendingPlace & { key?: number };
    indexes: { by_localId: string; by_synced: boolean };
  };
  pending_visibility_changes: {
    key: number;
    value: PendingVisibilityChange & { key?: number };
    indexes: { by_synced: boolean; by_routeId: string };
  };
  conflict_log: {
    key: number;
    value: ConflictLogEntry & { key?: number };
    indexes: { by_timestamp: number };
  };
}>;

let _db: LocalDb | null = null;

async function getDb(): Promise<LocalDb> {
  if (_db) return _db;

  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // ── pending_routes ──────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains('pending_routes')) {
        const routeStore = db.createObjectStore('pending_routes', {
          autoIncrement: true,
          keyPath: 'key',
        });
        routeStore.createIndex('by_flushed', 'flushed');
      }

      // ── pending_places ──────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains('pending_places')) {
        const placeStore = db.createObjectStore('pending_places', {
          autoIncrement: true,
          keyPath: 'key',
        });
        placeStore.createIndex('by_localId', 'localId', { unique: true });
        placeStore.createIndex('by_synced', 'synced');
      }

      // ── pending_visibility_changes ──────────────────────────────────────────
      if (!db.objectStoreNames.contains('pending_visibility_changes')) {
        const visStore = db.createObjectStore('pending_visibility_changes', {
          autoIncrement: true,
          keyPath: 'key',
        });
        visStore.createIndex('by_synced', 'synced');
        visStore.createIndex('by_routeId', 'routeId');
      }

      // ── conflict_log ────────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains('conflict_log')) {
        const logStore = db.createObjectStore('conflict_log', {
          autoIncrement: true,
          keyPath: 'key',
        });
        logStore.createIndex('by_timestamp', 'timestamp');
      }
    },
  }) as LocalDb;

  return _db;
}

// ─────────────────────────────────────────────────────────────────────────────
// pending_routes helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queue a coordinate batch into IndexedDB for later sync.
 * Raw coordinates only — never Kalman-filtered output (RULES.md §5.3).
 */
export async function queueCoordinateBatch(
  batch: PendingRouteBatch,
): Promise<void> {
  try {
    const db = await getDb();
    await db.add('pending_routes', { ...batch });
  } catch (err) {
    // Log and continue — do not crash the tracking session
    console.warn('[localDb] queueCoordinateBatch failed:', err);
  }
}

/**
 * Return all route batches that have not yet been flushed to the API.
 */
export async function getPendingBatches(): Promise<
  (PendingRouteBatch & { key: number })[]
> {
  try {
    const db = await getDb();
    const all = await db.getAll('pending_routes');
    return (all as (PendingRouteBatch & { key: number })[]).filter(
      (b) => !b.flushed,
    );
  } catch (err) {
    console.warn('[localDb] getPendingBatches failed:', err);
    return [];
  }
}

/**
 * Mark a route batch as flushed after successful API sync.
 */
export async function markBatchFlushed(key: number): Promise<void> {
  try {
    const db = await getDb();
    const item = await db.get('pending_routes', key);
    if (item) {
      item.flushed = true;
      await db.put('pending_routes', item);
    }
  } catch (err) {
    console.warn('[localDb] markBatchFlushed failed:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// pending_places helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queue a place into IndexedDB for later sync.
 */
export async function queuePlace(place: PendingPlace): Promise<void> {
  try {
    const db = await getDb();
    await db.add('pending_places', { ...place });
  } catch (err) {
    console.warn('[localDb] queuePlace failed:', err);
  }
}

/**
 * Return all places that have not yet been synced to the API.
 */
export async function getPendingPlaces(): Promise<
  (PendingPlace & { key: number })[]
> {
  try {
    const db = await getDb();
    const all = await db.getAll('pending_places');
    return (all as (PendingPlace & { key: number })[]).filter(
      (p) => !p.synced,
    );
  } catch (err) {
    console.warn('[localDb] getPendingPlaces failed:', err);
    return [];
  }
}

/**
 * Mark a place as synced by its localId.
 */
export async function markPlaceSynced(localId: string): Promise<void> {
  try {
    const db = await getDb();
    const all = await db.getAll('pending_places');
    const typed = all as (PendingPlace & { key: number })[];
    const item = typed.find((p) => p.localId === localId);
    if (item) {
      item.synced = true;
      await db.put('pending_places', item);
    }
  } catch (err) {
    console.warn('[localDb] markPlaceSynced failed:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// pending_visibility_changes helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return all visibility changes that have not yet been synced.
 */
export async function getPendingVisibilityChanges(): Promise<
  (PendingVisibilityChange & { key: number })[]
> {
  try {
    const db = await getDb();
    const all = await db.getAll('pending_visibility_changes');
    return (all as (PendingVisibilityChange & { key: number })[]).filter(
      (v) => !v.synced,
    );
  } catch (err) {
    console.warn('[localDb] getPendingVisibilityChanges failed:', err);
    return [];
  }
}

/**
 * Queue a visibility change into IndexedDB for later sync.
 */
export async function queueVisibilityChange(
  change: PendingVisibilityChange,
): Promise<void> {
  try {
    const db = await getDb();
    await db.add('pending_visibility_changes', { ...change });
  } catch (err) {
    console.warn('[localDb] queueVisibilityChange failed:', err);
  }
}

/**
 * Mark a visibility change as synced by its routeId.
 */
export async function markVisibilitySynced(routeId: string): Promise<void> {
  try {
    const db = await getDb();
    const all = await db.getAll('pending_visibility_changes');
    const typed = all as (PendingVisibilityChange & { key: number })[];
    const items = typed.filter((v) => v.routeId === routeId && !v.synced);
    for (const item of items) {
      item.synced = true;
      await db.put('pending_visibility_changes', item);
    }
  } catch (err) {
    console.warn('[localDb] markVisibilitySynced failed:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// conflict_log helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write a conflict resolution entry for debugging.
 */
export async function appendConflictLog(entry: ConflictLogEntry): Promise<void> {
  try {
    const db = await getDb();
    await db.add('conflict_log', { ...entry });
  } catch (err) {
    console.warn('[localDb] appendConflictLog failed:', err);
  }
}
