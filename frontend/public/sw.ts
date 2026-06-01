/// <reference lib="webworker" />
/**
 * public/sw.ts
 * Service Worker — handles Background Sync for offline route memory syncing.
 *
 * On 'sync' event with tag 'route-memory-sync':
 *   Messages all open clients to trigger syncAll() in the main thread.
 *   The main thread runs the actual sync — the SW avoids duplicating fetch logic.
 *
 * On 'install': skip waiting so the new SW activates immediately.
 * On 'activate': claim all clients so the SW controls open pages right away.
 *
 * TypeScript compilation: use tsconfig.sw.json (lib: WebWorker), NOT the main
 * tsconfig.json which targets the DOM environment.
 *
 * `export {}` makes this file a module so we can shadow the global `self`
 * (typed as WorkerGlobalScope in lib.webworker) with ServiceWorkerGlobalScope.
 */
export {};

declare const self: ServiceWorkerGlobalScope;

// ─────────────────────────────────────────────────────────────────────────────
// Install & Activate
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('install', () => {
  // Skip the waiting phase so this SW becomes active immediately
  void self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  // Take control of all open clients immediately
  event.waitUntil(self.clients.claim());
});

// ─────────────────────────────────────────────────────────────────────────────
// Background Sync
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SyncEvent is not yet in the standard TypeScript lib definitions.
 * We extend ExtendableEvent locally until it lands in lib.webworker.d.ts.
 */
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}

self.addEventListener('sync', (event: Event) => {
  const syncEvent = event as SyncEvent;

  if (syncEvent.tag === 'route-memory-sync') {
    syncEvent.waitUntil(
      // Message all open clients to trigger sync in the main thread.
      // This avoids duplicating IndexedDB + fetch logic inside the SW.
      self.clients.matchAll({ type: 'window' }).then((clients: readonly Client[]) => {
        clients.forEach((client: Client) => {
          client.postMessage({ type: 'TRIGGER_SYNC' });
        });
      }),
    );
  }
});

// No fetch handler — this SW only handles Background Sync.
// An empty fetch handler adds navigation overhead (browser warning).
// All network requests pass through to the browser's default handler.
