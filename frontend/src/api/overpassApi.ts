/**
 * src/api/overpassApi.ts
 * Overpass API client for fetching nearby points of interest.
 *
 * Fetches hotels, restaurants, fuel stations, cafes, hospitals,
 * pharmacies, ATMs, and parking from OpenStreetMap via the
 * Overpass API interpreter endpoint.
 *
 * Respects Overpass usage policy:
 *   - Client-side caching per bounds hash
 *   - Single request at a time (abort previous)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OverpassPOI {
  id: number;
  lat: number;
  lng: number;
  name: string;
  category: POICategory;
  tags: Record<string, string>;
}

export type POICategory =
  | 'restaurant'
  | 'hotel'
  | 'fuel'
  | 'cafe'
  | 'hospital'
  | 'pharmacy'
  | 'atm'
  | 'parking';

export const POI_CATEGORIES: { key: POICategory; label: string; emoji: string; query: string }[] = [
  { key: 'restaurant', label: 'Restaurant', emoji: '🍽️', query: 'amenity=restaurant' },
  { key: 'hotel',      label: 'Hotel',      emoji: '🏨', query: 'tourism=hotel' },
  { key: 'fuel',       label: 'Fuel',       emoji: '⛽', query: 'amenity=fuel' },
  { key: 'cafe',       label: 'Café',       emoji: '☕', query: 'amenity=cafe' },
  { key: 'hospital',   label: 'Hospital',   emoji: '🏥', query: 'amenity=hospital' },
  { key: 'pharmacy',   label: 'Pharmacy',   emoji: '💊', query: 'amenity=pharmacy' },
  { key: 'atm',        label: 'ATM',        emoji: '🏧', query: 'amenity=atm' },
  { key: 'parking',    label: 'Parking',    emoji: '🅿️', query: 'amenity=parking' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: OverpassPOI[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let activeController: AbortController | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Query builder
// ─────────────────────────────────────────────────────────────────────────────

function buildQuery(south: number, west: number, north: number, east: number): string {
  const bbox = `${south},${west},${north},${east}`;
  const nodeQueries = POI_CATEGORIES.map(
    (c) => `node[${c.query}](${bbox});`
  ).join('\n  ');

  return `
/* RouteMemoryApp/1.0 - Vercel Deployment */
[out:json][timeout:15];
(
  ${nodeQueries}
);
out body 50;
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Category detection
// ─────────────────────────────────────────────────────────────────────────────

function detectCategory(tags: Record<string, string>): POICategory {
  if (tags.tourism === 'hotel') return 'hotel';
  if (tags.amenity === 'restaurant') return 'restaurant';
  if (tags.amenity === 'cafe') return 'cafe';
  if (tags.amenity === 'fuel') return 'fuel';
  if (tags.amenity === 'hospital') return 'hospital';
  if (tags.amenity === 'pharmacy') return 'pharmacy';
  if (tags.amenity === 'atm') return 'atm';
  if (tags.amenity === 'parking') return 'parking';
  return 'restaurant'; // fallback
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch
// ─────────────────────────────────────────────────────────────────────────────

interface OverpassElement {
  type: string;
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * Fetch POIs within the given bounding box.
 * Caches results per bounds hash. Aborts previous in-flight request.
 */
export async function fetchPOIs(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OverpassPOI[]> {
  // Round to 3dp (~111m precision) for cache key stability
  const cacheKey = `${south.toFixed(3)},${west.toFixed(3)},${north.toFixed(3)},${east.toFixed(3)}`;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // Abort previous request
  if (activeController) {
    activeController.abort();
  }
  activeController = new AbortController();

  const query = buildQuery(south, west, north, east);

  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      signal: activeController.signal,
    });

    if (!resp.ok) {
      throw new Error(`Overpass API error: ${resp.status}`);
    }

    const json = (await resp.json()) as OverpassResponse;

    const pois: OverpassPOI[] = json.elements
      .filter((el) => el.type === 'node' && el.lat && el.lon)
      .map((el) => ({
        id: el.id,
        lat: el.lat,
        lng: el.lon,
        name: el.tags?.name ?? el.tags?.operator ?? 'Unnamed',
        category: detectCategory(el.tags ?? {}),
        tags: el.tags ?? {},
      }));

    // Store in cache
    cache.set(cacheKey, { data: pois, timestamp: Date.now() });

    return pois;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return []; // Silently return empty for aborted requests
    }
    throw err;
  }
}

/**
 * Get POI display info for a category
 */
export function getPOICategoryInfo(category: POICategory) {
  return POI_CATEGORIES.find((c) => c.key === category) ?? POI_CATEGORIES[0];
}
