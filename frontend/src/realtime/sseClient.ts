/**
 * src/realtime/sseClient.ts
 * Frontend SSE client — connects to GET /events and invalidates React Query caches.
 *
 * Token is passed as a query parameter (EventSource API doesn't support custom headers).
 * On 'server:shutdown': closes the EventSource and reconnects after 3 seconds.
 */

import { config } from '../config/env';

// Minimal interface — compatible with @tanstack/react-query QueryClient
// so callers can pass their QueryClient instance without a direct import here.
interface QueryClientLike {
  invalidateQueries(options: { queryKey: string[] }): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton EventSource
// ─────────────────────────────────────────────────────────────────────────────

let es: EventSource | null = null;

// In dev (VITE_API_URL=''), /api/events goes through the Vite proxy → localhost:3000
// In prod, VITE_API_URL is the deployed backend base URL
const EVENTS_URL = config.apiUrl
  ? `${config.apiUrl}/api/events`
  : '/api/events';


// ─────────────────────────────────────────────────────────────────────────────
// connectSSE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open an SSE connection to GET /events?token=<JWT>.
 * Registers event listeners that invalidate relevant React Query caches.
 *
 * Idempotent: calling while already connected is a no-op.
 *
 * @param token       - Valid JWT access token
 * @param queryClient - React Query QueryClient instance for cache invalidation
 */
export function connectSSE(token: string, queryClient: QueryClientLike): void {
  if (es) return; // already connected

  const url = `${EVENTS_URL}?token=${encodeURIComponent(token)}`;
  es = new EventSource(url);

  // ── Event: route completed ────────────────────────────────────────────────
  es.addEventListener('route:completed', () => {
    void queryClient.invalidateQueries({ queryKey: ['routes'] });
  });

  // ── Event: heatmap updated (community data changed) ───────────────────────
  es.addEventListener('heatmap:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['heatmap'] });
  });

  // ── Event: place saved ────────────────────────────────────────────────────
  es.addEventListener('place:saved', () => {
    void queryClient.invalidateQueries({ queryKey: ['places'] });
  });

  // ── Event: server shutting down ───────────────────────────────────────────
  es.addEventListener('server:shutdown', () => {
    es?.close();
    es = null;
    // Reconnect after 3 seconds
    setTimeout(() => connectSSE(token, queryClient), 3_000);
  });

  // ── Connection error ──────────────────────────────────────────────────────
  es.onerror = () => {
    // EventSource auto-reconnects — just log
    console.warn('[sseClient] EventSource connection error — will auto-reconnect');
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// disconnectSSE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Close the SSE connection.
 * Call on logout or app unmount.
 */
export function disconnectSSE(): void {
  if (es) {
    es.close();
    es = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// isConnected
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true when an active EventSource connection exists. */
export function isSseConnected(): boolean {
  return es !== null && es.readyState === EventSource.OPEN;
}
