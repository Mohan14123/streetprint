/**
 * src/config/env.ts
 * Frontend environment variable configuration.
 *
 * In development: VITE_API_URL is '' — Vite proxy rewrites /api/* to backend at localhost:3000.
 * In production:  VITE_API_URL is the deployed backend URL (e.g., https://api.streetprint.app).
 */

export const config = {
  apiUrl:      import.meta.env.VITE_API_URL ?? '',
  mapboxToken: import.meta.env.VITE_MAPBOX_TOKEN ?? '',
  isDev:       import.meta.env.DEV,
  isProd:      import.meta.env.PROD,
} as const;

// Validate at startup — warn if required production vars are missing
if (config.isProd && !import.meta.env.VITE_API_URL) {
  console.warn('[config] VITE_API_URL is not set in production');
}
