/**
 * public/sw.js
 * Service Worker — compiled from sw.ts.
 *
 * Vite serves public/ verbatim; browsers cannot execute TypeScript.
 * This file is the JS that the browser actually loads at /sw.js.
 * Edit sw.ts for type-safe development, then reflect changes here.
 *
 * On 'sync' event with tag 'route-memory-sync':
 *   Messages all open clients to trigger syncAll() in the main thread.
 *
 * On 'install': skip waiting so the new SW activates immediately.
 * On 'activate': claim all clients so the SW controls open pages right away.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Install & Activate
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ─────────────────────────────────────────────────────────────────────────────
// Background Sync
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'route-memory-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_SYNC' });
        });
      }),
    );
  }
});

// No fetch handler — this SW only handles Background Sync.
// An empty fetch handler adds navigation overhead (browser warning).
// All network requests pass through to the browser's default handler.
