/**
 * src/offline/conflictResolver.ts
 * Sync conflict resolution strategies for the offline-first architecture.
 *
 * Three resolution strategies are exported:
 *   lastWriteWins         — timestamp-based; ties prefer remote (server authoritative)
 *   mergeCoordinateArrays — deduplicate by 5dp rounding, local-first order (Rule 5.3: never reorder)
 *   resolveVisibilityConflict — timestamp-based; ties default to false (private = safer)
 *
 * Also exports: ConflictLog interface + logConflict() → writes to IndexedDB conflict_log store.
 */
import { appendConflictLog } from './localDb';

// ─────────────────────────────────────────────────────────────────────────────
// ConflictLog
// ─────────────────────────────────────────────────────────────────────────────

export interface ConflictLog {
  localValue: unknown;
  remoteValue: unknown;
  resolution: unknown;
  timestamp: number;
  entityType: string;
}

/**
 * Write a conflict resolution record to the IndexedDB conflict_log store.
 * Used for debugging sync divergences without surfacing them to the user.
 */
export async function logConflict(entry: ConflictLog): Promise<void> {
  await appendConflictLog({
    localValue: entry.localValue,
    remoteValue: entry.remoteValue,
    resolution: entry.resolution,
    timestamp: entry.timestamp,
    entityType: entry.entityType,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy 1 — Last Write Wins
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return whichever of local or remote has the higher timestamp.
 * On ties: prefer remote — server is authoritative.
 *
 * @param local  - Local entity with a timestamp field
 * @param remote - Remote entity with a timestamp field
 * @returns The entity that should be treated as canonical
 */
export function lastWriteWins<T extends { timestamp: number }>(
  local: T,
  remote: T,
): T {
  if (local.timestamp > remote.timestamp) return local;
  return remote; // equal timestamps: prefer remote
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy 2 — Merge Coordinate Arrays
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge two coordinate arrays while preserving insertion order and deduplicating.
 *
 * Rule 5.3 (RULES.md): Never reorder stored coordinates.
 * Deduplication key = both components rounded to 5 decimal places (≈ 1.1m precision).
 * Local coordinates come first; remote additions are appended in their original order.
 *
 * @param local  - Coordinates already in IndexedDB
 * @param remote - Coordinates from the server response
 * @returns Merged, deduplicated array — local order preserved
 */
export function mergeCoordinateArrays(
  local: [number, number][],
  remote: [number, number][],
): [number, number][] {
  const seen = new Set<string>();

  function key(coord: [number, number]): string {
    return `${coord[0].toFixed(5)},${coord[1].toFixed(5)}`;
  }

  const merged: [number, number][] = [];

  for (const coord of local) {
    const k = key(coord);
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(coord);
    }
  }

  for (const coord of remote) {
    const k = key(coord);
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(coord); // remote additions appended — never reordered
    }
  }

  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy 3 — Resolve Visibility Conflict
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine which visibility value wins between a local pending change
 * and the server's current value.
 *
 *   - local more recent  → use local.isPublic
 *   - remote more recent → use remote.isPublic
 *   - equal timestamps   → default false (private — safer default, Rule 7.1)
 *
 * @param local  - { isPublic, timestamp } from IndexedDB
 * @param remote - { isPublic, timestamp } from server
 * @returns Resolved boolean value for isPublic
 */
export function resolveVisibilityConflict(
  local: { isPublic: boolean; timestamp: number },
  remote: { isPublic: boolean; timestamp: number },
): boolean {
  if (local.timestamp > remote.timestamp) return local.isPublic;
  if (remote.timestamp > local.timestamp) return remote.isPublic;
  return false; // tie → private (safer default)
}
