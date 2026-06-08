/**
 * src/app/components/MapView.tsx
 * Map view — real GPS tracking, live polyline, record/stop FAB,
 * stats HUD, auto-follow via MapController, heatmap mode toggle,
 * and real route history in the bottom sheet.
 *
 * Rules enforced:
 *   yet_to_finish §1A: Map connected to real GPS via navigator.geolocation
 *   yet_to_finish §1B: Record/Stop FAB wired to useTracking
 *   yet_to_finish §1C: Live polyline from state.liveRoute
 *   yet_to_finish §1D: Stats HUD showing distance, elapsed time, motion badge
 *   yet_to_finish §1E: MapController auto-fly during tracking
 *   yet_to_finish §1G: Real routes in bottom sheet from routeApi.list()
 *   RULES.md §5.1: Coordinates displayed as [lat, lng] on Leaflet (reversed from GeoJSON)
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Square, Loader2, X, Crosshair, User, Layers, Bookmark, Clock, Radar } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useTracking } from '../../hooks/useTracking';
import { MapController } from './MapController';
import { routeApi } from '../../api/routes.api';
import { heatmapApi } from '../../api/heatmap.api';
import { useAuth } from '../../auth/AuthContext';
import { fetchPOIs, getPOICategoryInfo } from '../../api/overpassApi';
import type { OverpassPOI } from '../../api/overpassApi';
import { placesApi } from '../../api/places.api';
import { useTheme } from '../../hooks/useTheme';

// Fix for default marker icon in leaflet
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom icon for the pulsing location dot
const pulsingIcon = L.divIcon({
  className: 'custom-pulsing-icon',
  html: `
    <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; top: 0; left: 0; width: 32px; height: 32px; background-color: rgba(34, 211, 238, 0.3); border-radius: 50%; animation: pulse 2s infinite ease-in-out;"></div>
      <div style="position: relative; z-index: 10; width: 12px; height: 12px; background-color: #22d3ee; border-radius: 50%; border: 2px solid #0D1117; box-shadow: 0 0 10px rgba(34, 211, 238, 0.8);"></div>
    </div>
    <style>
      @keyframes pulse {
        0% { transform: scale(0.5); opacity: 0.8; }
        50% { opacity: 0; }
        100% { transform: scale(2); opacity: 0; }
      }
    </style>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

// ─────────────────────────────────────────────────────────────────────────────
// Types for route list
// ─────────────────────────────────────────────────────────────────────────────

interface RouteItem {
  _id: string;
  sessionId: string;
  status: string;
  coordinateCount: number;
  startedAt: string;
  endedAt?: string;
  tags: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatElapsedTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function routeDuration(start: string, end?: string): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function routeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const MOTION_BADGE_MAP: Record<string, { label: string; color: string }> = {
  stationary: { label: 'Still', color: 'bg-slate-500/20 text-[var(--sp-text-secondary)]' },
  walking:    { label: 'Walking', color: 'bg-emerald-500/20 text-emerald-400' },
  running:    { label: 'Running', color: 'bg-orange-500/20 text-orange-400' },
  driving:    { label: 'Driving', color: 'bg-purple-500/20 text-purple-400' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Speed-based color gradient (M7)
// Maps speed ratio (0-1) from yellow (slow) → green (medium) → cyan (fast)
// ─────────────────────────────────────────────────────────────────────────────

function speedToColor(speedRatio: number): string {
  // Clamp to [0, 1]
  const t = Math.max(0, Math.min(1, speedRatio));
  // Yellow (#eab308) → Green (#22c55e) → Cyan (#22d3ee)
  if (t < 0.5) {
    const s = t * 2; // 0 → 1 within first half
    const r = Math.round(234 * (1 - s) + 34 * s);
    const g = Math.round(179 * (1 - s) + 197 * s);
    const b = Math.round(8 * (1 - s) + 94 * s);
    return `rgb(${r},${g},${b})`;
  } else {
    const s = (t - 0.5) * 2; // 0 → 1 within second half
    const r = Math.round(34 * (1 - s) + 34 * s);
    const g = Math.round(197 * (1 - s) + 211 * s);
    const b = Math.round(94 * (1 - s) + 238 * s);
    return `rgb(${r},${g},${b})`;
  }
}

// Haversine between two [lat, lng] Leaflet-order points (for speed calc)
function haversineLatLng(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const a2 =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));
}

// Compute bearing between two [lat, lng] points for direction arrows (M8)
function computeBearing(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ─────────────────────────────────────────────────────────────────────────────
// Heatmap + Search types
// ─────────────────────────────────────────────────────────────────────────────

interface HeatmapPoint {
  lat: number;
  lng: number;
  intensity: number;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  class?: string;
}

const SEARCH_DEBOUNCE_MS = 600;
const SEARCH_HISTORY_KEY = 'streetprint_search_history';
const MAX_SEARCH_HISTORY = 8;

// Category emoji based on Nominatim result type/class
function getSearchResultEmoji(type?: string, cls?: string): string {
  if (cls === 'amenity') {
    if (type === 'restaurant' || type === 'cafe' || type === 'fast_food') return '🍴';
    if (type === 'hospital' || type === 'clinic' || type === 'pharmacy') return '🏥';
    if (type === 'school' || type === 'university' || type === 'college') return '🎓';
    if (type === 'fuel') return '⛽';
    if (type === 'bank' || type === 'atm') return '🏦';
    if (type === 'parking') return '🅿️';
    return '📍';
  }
  if (cls === 'tourism') {
    if (type === 'hotel' || type === 'hostel') return '🏨';
    if (type === 'attraction' || type === 'museum') return '🏛️';
    return '🗺️';
  }
  if (cls === 'shop') return '🛒';
  if (cls === 'highway') return '🛣️';
  if (cls === 'railway') return '🚂';
  if (cls === 'building') return '🏢';
  if (cls === 'place') {
    if (type === 'city' || type === 'town') return '🏙️';
    if (type === 'village' || type === 'hamlet') return '🏘️';
    if (type === 'country') return '🌍';
    if (type === 'state' || type === 'county') return '📌';
    return '📍';
  }
  if (cls === 'natural') return '🌿';
  if (cls === 'leisure') {
    if (type === 'park') return '🌳';
    if (type === 'stadium') return '🏟️';
    return '🎭';
  }
  if (cls === 'waterway') return '💧';
  return '📍';
}

// Color ramps for heatmap modes
const HEATMAP_COLORS: Record<string, { fill: string; stroke: string }> = {
  'my-routes': { fill: '#06b6d4', stroke: '#06b6d4' },
  'community': { fill: '#f97316', stroke: '#f97316' },
  'unexplored': { fill: '#1e3a8a', stroke: '#1e3a8a' },
};

// ─────────────────────────────────────────────────────────────────────────────
// MapBoundsHandler — fires callback on moveend
// ─────────────────────────────────────────────────────────────────────────────

function MapBoundsHandler({ onBoundsChange }: { onBoundsChange: (bounds: string) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      const boundsStr = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
      onBoundsChange(boundsStr);
    },
  });
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZoomTracker — tracks current zoom level for heatmap scaling
// ─────────────────────────────────────────────────────────────────────────────

function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => {
      onZoomChange(map.getZoom());
    },
  });
  // Fire initial zoom
  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SearchFlyTo — flies map to a position
// ─────────────────────────────────────────────────────────────────────────────

function SearchFlyTo({ position }: { position: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      map.flyTo(position, 16, { duration: 1.5 });
    }
  }, [map, position]);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RecenterControl — flies map to user position on demand
// ─────────────────────────────────────────────────────────────────────────────

function RecenterControl({ position, triggerKey }: { position: [number, number] | null; triggerKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (position && triggerKey > 0) {
      map.flyTo(position, 16, { duration: 1 });
    }
  }, [map, position, triggerKey]);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MapCenterSaver — persists map center to localStorage on move
// ─────────────────────────────────────────────────────────────────────────────

function MapCenterSaver() {
  useMapEvents({
    moveend: (e) => {
      const center = e.target.getCenter();
      localStorage.setItem('streetprint_last_center', JSON.stringify([center.lat, center.lng]));
    },
  });
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MapView() {
  const { state: tracking, startTracking, stopTracking } = useTracking();
  const { theme } = useTheme();
  const [showAccuracy, setShowAccuracy] = useState(() => {
    return localStorage.getItem('streetprint_show_accuracy') !== 'false';
  });
  const [accuracyRadius, setAccuracyRadius] = useState<number>(0);
  const handleToggleAccuracy = useCallback(() => {
    setShowAccuracy(v => {
      const newVal = !v;
      localStorage.setItem('streetprint_show_accuracy', String(newVal));
      return newVal;
    });
  }, []);
  const { user } = useAuth();

  const [sheetState, setSheetState] = useState<'collapsed' | 'half' | 'expanded'>('collapsed');
  const [heatmapMode, setHeatmapMode] = useState<'my-routes' | 'unexplored'>('my-routes');

  const sheetRef = useRef<HTMLDivElement>(null);

  // ── User location ──────────────────────────────────────────────────────────
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);

  // Get user's real position on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newPos: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserPosition(newPos);
        setAccuracyRadius(pos.coords.accuracy);
        // Persist last known center for session restore
        localStorage.setItem('streetprint_last_center', JSON.stringify(newPos));
        setLocationLoading(false);
      },
      () => {
        // Fallback to last saved center or default position if geolocation denied
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  // Update position from tracking when active
  const latestTrackingPosition: [number, number] | null = useMemo(() => {
    if (tracking.liveRoute.length > 0) {
      const last = tracking.liveRoute[tracking.liveRoute.length - 1];
      // liveRoute coords are [lng, lat] (GeoJSON) → reverse for Leaflet
      return [last[1], last[0]];
    }
    return null;
  }, [tracking.liveRoute, tracking.liveRoute.length]);

  const displayPosition = latestTrackingPosition ?? userPosition;
  const currentAccuracy = tracking.currentAccuracy ?? accuracyRadius;

  // Default center: try saved session center, then fallback to New York
  const savedCenter = (() => {
    try {
      const saved = localStorage.getItem('streetprint_last_center');
      if (saved) return JSON.parse(saved) as [number, number];
    } catch { /* ignore */ }
    return null;
  })();
  const mapCenter: [number, number] = displayPosition ?? savedCenter ?? [40.7128, -74.006];

  // ── Elapsed time counter ───────────────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackingStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (tracking.isTracking) {
      trackingStartRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - (trackingStartRef.current ?? Date.now()));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setElapsed(0);
      trackingStartRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [tracking.isTracking]);

  // ── Record/Stop handlers ───────────────────────────────────────────────────
  const [isStarting, setIsStarting] = useState(false);

  const handleRecord = useCallback(async () => {
    setIsStarting(true);
    await startTracking();
    setIsStarting(false);
  }, [startTracking]);

  const handleStop = useCallback(async () => {
    await stopTracking();
  }, [stopTracking]);

  // ── Bottom sheet route list ────────────────────────────────────────────────
  const [recentRoutes, setRecentRoutes] = useState<RouteItem[]>([]);
  const [routesLoading, setRoutesLoading] = useState(true);

  useEffect(() => {
    routeApi
      .list()
      .then((resp) => {
        const data = resp.data as { data: { routes: RouteItem[] } };
        setRecentRoutes((data.data.routes ?? []).slice(0, 5));
      })
      .catch(() => {
        // Silently fail — show empty
      })
      .finally(() => setRoutesLoading(false));
  }, []);

  // ── Polyline positions (GeoJSON [lng,lat] → Leaflet [lat,lng]) ─────────────
  const polylinePositions: [number, number][] = tracking.liveRoute.map(([lng, lat]) => [lat, lng]);

  // ── Zoom state (used by M6, M8, and heatmap radius) ───────────────────────
  const [currentZoom, setCurrentZoom] = useState(15);
  const handleZoomChange = useCallback((zoom: number) => {
    setCurrentZoom(zoom);
  }, []);

  // ── M5: Animated progressive route reveal ──────────────────────────────────
  const [revealedCount, setRevealedCount] = useState(0);
  const animFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  useEffect(() => {
    if (polylinePositions.length <= revealedCount) {
      setRevealedCount(polylinePositions.length);
      return;
    }
    let current = revealedCount;
    const target = polylinePositions.length;
    const step = () => {
      current = Math.min(current + 2, target);
      setRevealedCount(current);
      if (current < target) {
        animFrameRef.current = requestAnimationFrame(step);
      }
    };
    animFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polylinePositions.length]);

  useEffect(() => {
    if (!tracking.isTracking) setRevealedCount(0);
  }, [tracking.isTracking]);

  const revealedPositions = polylinePositions.slice(0, revealedCount);

  // ── M6: Zoom-based line width ──────────────────────────────────────────────
  const routeLineWeight = useMemo(() => {
    if (currentZoom >= 17) return 6;
    if (currentZoom >= 15) return 5;
    if (currentZoom >= 13) return 4;
    if (currentZoom >= 10) return 3;
    return 2;
  }, [currentZoom]);

  // ── M7: Speed-based gradient polyline segments ─────────────────────────────
  const speedSegments = useMemo(() => {
    if (revealedPositions.length < 2) return [];
    const segments: { positions: [number, number][]; color: string }[] = [];
    const speeds: number[] = [];
    for (let i = 1; i < revealedPositions.length; i++) {
      const dist = haversineLatLng(revealedPositions[i - 1], revealedPositions[i]);
      speeds.push(dist);
    }
    const maxSpeed = Math.max(1, ...speeds);
    for (let i = 0; i < speeds.length; i++) {
      const ratio = speeds[i] / maxSpeed;
      segments.push({
        positions: [revealedPositions[i], revealedPositions[i + 1]],
        color: speedToColor(ratio),
      });
    }
    return segments;
  }, [revealedPositions]);

  // ── M8: Direction arrows at intervals along the polyline ───────────────────
  const directionArrows = useMemo(() => {
    if (revealedPositions.length < 3) return [];
    const interval = currentZoom >= 16 ? 5 : currentZoom >= 13 ? 10 : 20;
    const arrows: { position: [number, number]; bearing: number }[] = [];
    for (let i = interval; i < revealedPositions.length - 1; i += interval) {
      const bearing = computeBearing(revealedPositions[i - 1], revealedPositions[i]);
      arrows.push({ position: revealedPositions[i], bearing });
    }
    return arrows;
  }, [revealedPositions, currentZoom]);

  const createArrowIcon = useCallback((bearing: number) => {
    return L.divIcon({
      className: 'route-arrow-icon',
      html: `<div style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;transform:rotate(${bearing}deg);font-size:12px;color:#22d3ee;filter:drop-shadow(0 0 2px rgba(34,211,238,0.6));pointer-events:none;">▲</div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }, []);

  // ── Motion badge ───────────────────────────────────────────────────────────
  const motionBadge = MOTION_BADGE_MAP[tracking.currentMotionState] ?? MOTION_BADGE_MAP.walking;

  // ── Heatmap data ──────────────────────────────────────────────────────────
  const [heatmapPoints, setHeatmapPoints] = useState<HeatmapPoint[]>([]);
  const currentBoundsRef = useRef<string>('');
  const heatmapDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchHeatmap = useCallback(async (bounds: string) => {
    if (!bounds) return;
    try {
      const userId = heatmapMode === 'my-routes' ? user?.id : undefined;
      const resp = await heatmapApi.get(bounds, userId);
      const data = resp.data as { data: { points: HeatmapPoint[] } };
      setHeatmapPoints(data.data.points ?? []);
    } catch {
      // Non-fatal — show empty heatmap
      setHeatmapPoints([]);
    }
  }, [heatmapMode, user?.id]);

  // Debounced bounds change handler — prevents 429 API spam (errors.md #5)
  const handleBoundsChange = useCallback((bounds: string) => {
    currentBoundsRef.current = bounds;
    if (heatmapDebounceRef.current) clearTimeout(heatmapDebounceRef.current);
    heatmapDebounceRef.current = setTimeout(() => {
      void fetchHeatmap(bounds);
    }, 600);
  }, [fetchHeatmap]);

  // Re-fetch when heatmap mode changes
  useEffect(() => {
    if (currentBoundsRef.current) {
      void fetchHeatmap(currentBoundsRef.current);
    }
  }, [heatmapMode, fetchHeatmap]);

  // Compute max intensity for normalization
  const maxIntensity = Math.max(1, ...heatmapPoints.map(p => p.intensity));

  // Zoom-aware heatmap radius: larger at low zoom, smaller at high zoom
  const heatmapBaseRadius = (() => {
    // At zoom 15: base=30, max scale factor=120
    // At zoom 3: base=2000, max scale factor=5000
    if (currentZoom >= 15) return { base: 30, scale: 120 };
    if (currentZoom >= 12) return { base: 80, scale: 300 };
    if (currentZoom >= 9) return { base: 300, scale: 1000 };
    if (currentZoom >= 6) return { base: 1000, scale: 3000 };
    return { base: 2000, scale: 5000 };
  })();

  // ── M10: Search history (localStorage) ───────────────────────────────────
  const [searchHistory, setSearchHistory] = useState<{ name: string; lat: string; lon: string }[]>(() => {
    try {
      const saved = localStorage.getItem(SEARCH_HISTORY_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);

  const addToSearchHistory = useCallback((name: string, lat: string, lon: string) => {
    setSearchHistory(prev => {
      const filtered = prev.filter(h => h.name !== name);
      const updated = [{ name, lat, lon }, ...filtered].slice(0, MAX_SEARCH_HISTORY);
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeFromHistory = useCallback((name: string) => {
    setSearchHistory(prev => {
      const updated = prev.filter(h => h.name !== name);
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ── Nominatim search ──────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFlyTarget, setSearchFlyTarget] = useState<[number, number] | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setShowHistory(false);

    if (!value.trim()) {
      setSearchResults([]);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&limit=5&addressdetails=1`,
          { headers: { 'User-Agent': 'RouteMemoryApp/1.0' } },
        );
        const data = (await resp.json()) as NominatimResult[];
        setSearchResults(data);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  const handleSearchSelect = useCallback((result: NominatimResult) => {
    const target: [number, number] = [parseFloat(result.lat), parseFloat(result.lon)];
    setSearchFlyTarget(target);
    const shortName = result.display_name.split(',')[0];
    setSearchQuery(shortName);
    setSearchResults([]);
    setShowHistory(false);
    addToSearchHistory(shortName, result.lat, result.lon);
  }, [addToSearchHistory]);

  const handleHistorySelect = useCallback((item: { name: string; lat: string; lon: string }) => {
    const target: [number, number] = [parseFloat(item.lat), parseFloat(item.lon)];
    setSearchFlyTarget(target);
    setSearchQuery(item.name);
    setShowHistory(false);
  }, []);

  // M10: Save place directly from search results
  const [savingPlaceId, setSavingPlaceId] = useState<number | null>(null);
  const handleSaveFromSearch = useCallback(async (result: NominatimResult) => {
    setSavingPlaceId(result.place_id);
    try {
      await placesApi.save({
        label: result.display_name.split(',')[0],
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
        notes: result.type ? `${result.type} (${result.class ?? 'place'})` : undefined,
      });
    } catch {
      // Non-fatal
    } finally {
      setSavingPlaceId(null);
    }
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchFlyTarget(null);
    setShowHistory(false);
  }, []);

  const handleSearchFocus = useCallback(() => {
    if (!searchQuery.trim() && searchHistory.length > 0) {
      setShowHistory(true);
    }
  }, [searchQuery, searchHistory.length]);

  // ── Re-center handler ─────────────────────────────────────────────────────
  const [recenterKey, setRecenterKey] = useState(0);
  const handleRecenter = useCallback(() => {
    setRecenterKey(k => k + 1);
  }, []);


  // ── Overpass POI Layer (spatial caching — errors.md #7) ────────────────────
  const [showPOIs, setShowPOIs] = useState(false);
  const [poiData, setPOIData] = useState<OverpassPOI[]>([]);
  const poiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Spatial cache: store fetched POIs for a larger area, filter locally on pan
  const poiCacheRef = useRef<{
    center: [number, number]; // [lat, lng] of fetch center
    pois: OverpassPOI[];
    fetchRadiusKm: number;
  } | null>(null);

  const POI_FETCH_RADIUS_KM = 2.5;    // Fetch POIs in a 2.5km radius
  const POI_REFETCH_THRESHOLD_KM = 1;  // Re-fetch only when center drifts >1km

  // Haversine for cache distance check (lat/lng order)
  const poiHaversine = useCallback((a: [number, number], b: [number, number]): number => {
    const R = 6_371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }, []);

  // Filter cached POIs to fit current viewport bounds
  const filterPOIsToViewport = useCallback((pois: OverpassPOI[], boundsStr: string): OverpassPOI[] => {
    const [west, south, east, north] = boundsStr.split(',').map(Number);
    return pois.filter(p => p.lat >= south && p.lat <= north && p.lng >= west && p.lng <= east);
  }, []);

  // Fetch POIs when bounds change and zoom >= 14
  const handlePOIBoundsChange = useCallback((boundsStr: string, zoom: number) => {
    if (!showPOIs || zoom < 14) {
      setPOIData([]);
      return;
    }

    const [west, south, east, north] = boundsStr.split(',').map(Number);
    const viewCenter: [number, number] = [(south + north) / 2, (west + east) / 2];

    // Check if cached data covers the current viewport
    if (poiCacheRef.current) {
      const distFromCache = poiHaversine(poiCacheRef.current.center, viewCenter);
      if (distFromCache < POI_REFETCH_THRESHOLD_KM) {
        // Cache hit — filter locally, no API call
        setPOIData(filterPOIsToViewport(poiCacheRef.current.pois, boundsStr));
        return;
      }
    }

    // Cache miss — debounce and fetch a larger area
    if (poiDebounceRef.current) clearTimeout(poiDebounceRef.current);
    poiDebounceRef.current = setTimeout(async () => {
      try {
        // Expand bounds to ~2.5km radius from center
        const degOffset = POI_FETCH_RADIUS_KM / 111; // ~1 degree ≈ 111km
        const fetchSouth = viewCenter[0] - degOffset;
        const fetchNorth = viewCenter[0] + degOffset;
        const fetchWest = viewCenter[1] - degOffset;
        const fetchEast = viewCenter[1] + degOffset;

        const pois = await fetchPOIs(fetchSouth, fetchWest, fetchNorth, fetchEast);

        // Update cache
        poiCacheRef.current = {
          center: viewCenter,
          pois,
          fetchRadiusKm: POI_FETCH_RADIUS_KM,
        };

        // Filter to viewport and display
        setPOIData(filterPOIsToViewport(pois, boundsStr));
      } catch {
        // Non-fatal
      }
    }, 1500);
  }, [showPOIs, poiHaversine, filterPOIsToViewport]);

  // ── Stable ZoomTracker callback (fixes infinite render loop — errors.md #1) ─
  const onZoomChangeTracker = useCallback((z: number) => {
    handleZoomChange(z);
    if (currentBoundsRef.current) {
      handlePOIBoundsChange(currentBoundsRef.current, z);
    }
  }, [handleZoomChange, handlePOIBoundsChange]);

  // Re-fetch when POI toggle changes
  useEffect(() => {
    if (showPOIs && currentBoundsRef.current && currentZoom >= 14) {
      // Invalidate cache on toggle
      poiCacheRef.current = null;
      handlePOIBoundsChange(currentBoundsRef.current, currentZoom);
    } else if (!showPOIs) {
      setPOIData([]);
      poiCacheRef.current = null;
    }
  }, [showPOIs, currentZoom, handlePOIBoundsChange]);

  // Create POI icons lazily
  const createPOIIcon = useCallback((emoji: string) => {
    return L.divIcon({
      className: 'poi-marker-icon',
      html: `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:rgba(13,17,23,0.85);border:1px solid rgba(255,255,255,0.15);border-radius:8px;font-size:16px;backdrop-filter:blur(4px);box-shadow:0 2px 8px rgba(0,0,0,0.4);">${emoji}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32],
    });
  }, []);

  // Route start position for marker
  const routeStartPosition: [number, number] | null =
    polylinePositions.length > 0 ? polylinePositions[0] : null;

  // M4: Route end position for marker (red dot)
  const routeEndPosition: [number, number] | null =
    revealedPositions.length > 1 ? revealedPositions[revealedPositions.length - 1] : null;

  // Bottom sheet Y positions
  const sheetY = sheetState === 'expanded' ? 0 : sheetState === 'half' ? 'calc(100% - 45vh)' : 'calc(100% - 130px)';

  return (
    <div className="relative w-full h-full overflow-hidden font-sans" style={{ background: 'var(--sp-bg-primary)', color: 'var(--sp-text-primary)' }}>
      {/* Real Interactive Map */}
      <div className="absolute inset-0 z-0">
        {locationLoading ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
          </div>
        ) : (
          <MapContainer
            center={mapCenter}
            zoom={15}
            zoomControl={false}
            minZoom={3}
            maxBounds={[[-85, -180], [85, 180]]}
            maxBoundsViscosity={1.0}
            worldCopyJump={true}
            style={{ width: '100%', height: '100%', background: 'var(--sp-map-bg)' }}
          >
            {/* CartoDB Dark Matter tile layer (No API key needed, dark theme) */}
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url={theme === 'light' ? "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"}
              noWrap={true}
            />

            
            {/* Auto-follow controller */}
            <MapController position={displayPosition} isTracking={tracking.isTracking} />

            {/* H4: GPS Accuracy Circle */}
            {showAccuracy && displayPosition && currentAccuracy > 0 && (
              <Circle
                center={displayPosition}
                radius={currentAccuracy}
                pathOptions={{
                  color: '#22d3ee',
                  fillColor: '#22d3ee',
                  fillOpacity: 0.1,
                  weight: 1,
                  dashArray: '4 4'
                }}
                interactive={false}
              />
            )}


            {/* Current Location Marker */}
            {displayPosition && <Marker position={displayPosition} icon={pulsingIcon} />}

            {/* Live route polyline — M7: speed-based color gradient segments */}
            {speedSegments.length > 0 ? (
              speedSegments.map((seg, i) => (
                <Polyline
                  key={`seg-${i}`}
                  positions={seg.positions}
                  pathOptions={{
                    color: seg.color,
                    weight: routeLineWeight,  /* M6: zoom-based width */
                    opacity: 0.9,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              ))
            ) : revealedPositions.length > 1 ? (
              /* Fallback: single-color line if less than 2 segments */
              <Polyline
                positions={revealedPositions}
                pathOptions={{
                  color: '#22d3ee',
                  weight: routeLineWeight,
                  opacity: 0.9,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            ) : null}

            {/* M8: Direction arrows along the polyline */}
            {tracking.isTracking && directionArrows.map((arrow, i) => (
              <Marker
                key={`arrow-${i}`}
                position={arrow.position}
                icon={createArrowIcon(arrow.bearing)}
                interactive={false}
              />
            ))}

            {/* Route start marker (green dot) */}
            {routeStartPosition && tracking.isTracking && (
              <CircleMarker
                center={routeStartPosition}
                radius={8}
                pathOptions={{ color: '#16a34a', fillColor: '#22c55e', fillOpacity: 1, weight: 3 }}
              />
            )}

            {/* M4: Route end marker (red dot) — visible during tracking */}
            {routeEndPosition && tracking.isTracking && (
              <CircleMarker
                center={routeEndPosition}
                radius={7}
                pathOptions={{ color: '#dc2626', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }}
              />
            )}

            {/* Heatmap API-driven overlays — zoom-aware radius */}
            {heatmapPoints.map((point, i) => {
              const colors = HEATMAP_COLORS[heatmapMode] ?? HEATMAP_COLORS['my-routes'];
              const normalizedIntensity = point.intensity / maxIntensity;
              return (
                <Circle
                  key={`hp-${i}`}
                  center={[point.lat, point.lng]}
                  radius={heatmapBaseRadius.base + normalizedIntensity * heatmapBaseRadius.scale}
                  pathOptions={{
                    color: colors.stroke,
                    fillColor: colors.fill,
                    fillOpacity: 0.15 + normalizedIntensity * 0.4,
                    stroke: false,
                  }}
                />
              );
            })}

            {/* Bounds change handler for heatmap refetch */}
            <MapBoundsHandler onBoundsChange={(bounds) => {
              handleBoundsChange(bounds);
              handlePOIBoundsChange(bounds, currentZoom);
            }} />

            {/* Zoom tracker for heatmap scaling */}
            <ZoomTracker onZoomChange={onZoomChangeTracker} />

            {/* POI markers from Overpass */}
            {showPOIs && poiData.map((poi) => {
              const catInfo = getPOICategoryInfo(poi.category);
              return (
                <Marker
                  key={`poi-${poi.id}`}
                  position={[poi.lat, poi.lng]}
                  icon={createPOIIcon(catInfo.emoji)}
                >
                  <Popup
                    className="poi-popup"
                    closeButton={true}
                    autoPan={true}
                  >
                    <div style={{ minWidth: '200px', fontFamily: 'Inter, sans-serif' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '20px' }}>{catInfo.emoji}</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '14px', color: '#e2e8f0' }}>{poi.name}</div>
                          <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'capitalize' }}>{catInfo.label}</div>
                        </div>
                      </div>
                      {poi.tags['addr:street'] && (
                        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                          📍 {poi.tags['addr:street']}{poi.tags['addr:housenumber'] ? ` ${poi.tags['addr:housenumber']}` : ''}
                        </div>
                      )}
                      {poi.tags.opening_hours && (
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                          🕐 {poi.tags.opening_hours}
                        </div>
                      )}
                      {poi.tags.phone && (
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                          📞 {poi.tags.phone}
                        </div>
                      )}
                      {poi.tags.website && (
                        <div style={{ fontSize: '11px', marginBottom: '4px' }}>
                          <a href={poi.tags.website} target="_blank" rel="noopener noreferrer" style={{ color: '#22d3ee', textDecoration: 'none' }}>
                            🌐 Website
                          </a>
                        </div>
                      )}
                      {poi.tags.cuisine && (
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                          🍴 {poi.tags.cuisine.replace(/;/g, ', ')}
                        </div>
                      )}
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            {/* Search fly-to + recenter + center persistence */}
            <SearchFlyTo position={searchFlyTarget} />
            <RecenterControl position={displayPosition} triggerKey={recenterKey} />
            <MapCenterSaver />

            {/* Search result marker */}
            {searchFlyTarget && (
              <Marker position={searchFlyTarget} />
            )}
          </MapContainer>
        )}
      </div>

      {/* Overlays Wrapper */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        <AnimatePresence>
          {heatmapMode === 'unexplored' && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-blue-900/10 mix-blend-screen pointer-events-none"
            />
          )}
        </AnimatePresence>
      </div>

      {/* Top Bar */}
      <div className="absolute top-0 inset-x-0 p-4 pt-8 z-20 flex gap-3 pointer-events-none">
        <div className="flex-1 relative pointer-events-auto">
          <div className="h-12 bg-[var(--sp-bg-overlay)] backdrop-blur-xl border border-[var(--sp-border-strong)] rounded-full flex items-center px-4 shadow-lg">
            {searchLoading ? (
              <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
            ) : (
              <Search className="w-5 h-5 text-[var(--sp-text-secondary)]" />
            )}
            <input
              type="text"
              placeholder="Search places, routes..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onFocus={handleSearchFocus}
              onBlur={() => setTimeout(() => setShowHistory(false), 200)}
              className="bg-transparent border-none outline-none text-sm text-[var(--sp-text-primary)] ml-3 w-full placeholder:text-[var(--sp-text-muted)]"
            />
            {searchQuery && (
              <button onClick={clearSearch} className="text-[var(--sp-text-muted)] hover:text-[var(--sp-text-primary)] ml-1">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* M10: Search history dropdown (when input focused, no query) */}
          {showHistory && searchHistory.length > 0 && searchResults.length === 0 && (
            <div className="absolute top-14 left-0 right-0 bg-[var(--sp-bg-overlay)] backdrop-blur-xl border border-[var(--sp-border-strong)] rounded-2xl overflow-hidden shadow-2xl max-h-60 overflow-y-auto">
              <div className="px-4 py-2 text-[10px] text-slate-600 uppercase tracking-wider font-semibold">Recent Searches</div>
              {searchHistory.map((item) => (
                <div
                  key={item.name}
                  className="w-full flex items-center px-4 py-2.5 hover:bg-[var(--sp-bg-input)] transition-colors border-b border-[var(--sp-border)] last:border-b-0 gap-3"
                >
                  <Clock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  <button
                    onClick={() => handleHistorySelect(item)}
                    className="flex-1 text-left"
                  >
                    <p className="text-sm text-[var(--sp-text-primary)] truncate">{item.name}</p>
                  </button>
                  <button
                    onClick={() => removeFromHistory(item.name)}
                    className="text-slate-600 hover:text-[var(--sp-text-primary)] transition-colors p-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* M10: Enhanced search results with category icons + save button */}
          {searchResults.length > 0 && (
            <div className="absolute top-14 left-0 right-0 bg-[var(--sp-bg-overlay)] backdrop-blur-xl border border-[var(--sp-border-strong)] rounded-2xl overflow-hidden shadow-2xl max-h-72 overflow-y-auto">
              {searchResults.map((result) => (
                <div
                  key={result.place_id}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--sp-bg-input)] transition-colors border-b border-[var(--sp-border)] last:border-b-0"
                >
                  {/* Category emoji icon */}
                  <span className="text-base shrink-0">{getSearchResultEmoji(result.type, result.class)}</span>
                  {/* Result text — click to fly */}
                  <button
                    onClick={() => handleSearchSelect(result)}
                    className="flex-1 text-left min-w-0"
                  >
                    <p className="text-sm text-[var(--sp-text-primary)] truncate">{result.display_name.split(',')[0]}</p>
                    <p className="text-[11px] text-[var(--sp-text-muted)] truncate mt-0.5">{result.display_name.split(',').slice(1, 3).join(',')}</p>
                    {result.type && (
                      <span className="text-[10px] text-slate-600 capitalize">{result.type.replace(/_/g, ' ')}</span>
                    )}
                  </button>
                  {/* Save to places button */}
                  <button
                    onClick={() => handleSaveFromSearch(result)}
                    disabled={savingPlaceId === result.place_id}
                    className="text-slate-600 hover:text-cyan-400 transition-colors p-1.5 rounded-lg hover:bg-[var(--sp-bg-input)] shrink-0"
                    title="Save to places"
                  >
                    {savingPlaceId === result.place_id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Bookmark className="w-4 h-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-600/20 backdrop-blur-xl border border-cyan-500/20 flex items-center justify-center pointer-events-auto shadow-[0_0_15px_rgba(34,211,238,0.15)] shrink-0">
          <User className="w-6 h-6 text-cyan-400" />
        </button>
      </div>

      {/* Heatmap loading is silent — no visible loading indicator per user request */}

      {/* Heatmap Toggle Panel */}
      <div className="absolute top-24 inset-x-0 flex justify-center z-20 pointer-events-none">
        <div className="bg-[var(--sp-bg-overlay)] backdrop-blur-xl border border-[var(--sp-border-strong)] p-1 rounded-full flex gap-1 pointer-events-auto shadow-lg">
          {(['my-routes', 'unexplored'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setHeatmapMode(mode)}
              className={`px-4 py-2 rounded-full text-xs font-medium transition-all duration-300 capitalize ${
                heatmapMode === mode
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                  : 'text-[var(--sp-text-secondary)] hover:text-[var(--sp-text-primary)]'
              }`}
            >
              {mode.replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* ── Live Tracking Stats HUD ─────────────────────────────────────────── */}
      <AnimatePresence>
        {tracking.isTracking && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="absolute top-40 inset-x-0 flex justify-center z-20 pointer-events-none"
          >
            <div className="bg-[var(--sp-bg-overlay)] backdrop-blur-xl border border-cyan-500/20 rounded-2xl px-5 py-3 pointer-events-auto shadow-[0_0_30px_rgba(34,211,238,0.15)] flex items-center gap-5">
              {/* Distance */}
              <div className="text-center">
                <p className="text-lg font-bold text-[var(--sp-text-primary)] tabular-nums">
                  {formatDistance(tracking.distanceMeters)}
                </p>
                <p className="text-[10px] text-[var(--sp-text-muted)] uppercase tracking-wider">Distance</p>
              </div>

              <div className="w-px h-8 bg-white/10" />

              {/* Elapsed Time */}
              <div className="text-center">
                <p className="text-lg font-bold text-[var(--sp-text-primary)] tabular-nums font-mono">
                  {formatElapsedTime(elapsed)}
                </p>
                <p className="text-[10px] text-[var(--sp-text-muted)] uppercase tracking-wider">Time</p>
              </div>

              <div className="w-px h-8 bg-white/10" />

              {/* Motion Badge */}
              <div className="text-center">
                <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${motionBadge.color}`}>
                  {motionBadge.label}
                </span>
                <p className="text-[10px] text-[var(--sp-text-muted)] uppercase tracking-wider mt-0.5">Motion</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Left Button Column (Re-center + POI toggle) ─────────────────── */}
      <div className="absolute bottom-36 left-5 z-30 pointer-events-auto flex flex-col gap-3">
        
        {/* Accuracy Toggle */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleToggleAccuracy}
          className={`w-12 h-12 rounded-full backdrop-blur-xl border flex items-center justify-center shadow-lg transition-colors ${
            showAccuracy
              ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400'
              : 'bg-[var(--sp-bg-overlay)] border-[var(--sp-border-strong)] text-[var(--sp-text-secondary)] hover:text-cyan-400'
          }`}
          title={showAccuracy ? 'Hide GPS accuracy' : 'Show GPS accuracy'}
        >
          <Radar className="w-5 h-5" />
        </motion.button>

        {/* POI Layer Toggle */}

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowPOIs(p => !p)}
          className={`w-12 h-12 rounded-full backdrop-blur-xl border flex items-center justify-center shadow-lg transition-colors ${
            showPOIs
              ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400'
              : 'bg-[var(--sp-bg-overlay)] border-[var(--sp-border-strong)] text-[var(--sp-text-secondary)] hover:text-cyan-400'
          }`}
          title={showPOIs ? 'Hide nearby places' : 'Show nearby places (zoom in for details)'}
        >
          <Layers className="w-5 h-5" />
        </motion.button>

        {/* Re-center */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleRecenter}
          className="w-12 h-12 rounded-full bg-[var(--sp-bg-overlay)] backdrop-blur-xl border border-[var(--sp-border-strong)] flex items-center justify-center shadow-lg text-[var(--sp-text-secondary)] hover:text-cyan-400 transition-colors"
          title="Re-center on my location"
        >
          <Crosshair className="w-5 h-5" />
        </motion.button>
      </div>

      {/* ── Record / Stop FAB ───────────────────────────────────────────────── */}
      <div className="absolute bottom-36 right-5 z-30 pointer-events-auto">
        {!tracking.isTracking ? (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleRecord}
            disabled={isStarting}
            className="w-16 h-16 rounded-full bg-gradient-to-br from-red-500 to-red-600 shadow-[0_0_30px_rgba(239,68,68,0.4)] flex items-center justify-center border-2 border-red-400/30 disabled:opacity-50"
          >
            {isStarting ? (
              <Loader2 className="w-6 h-6 text-[var(--sp-text-primary)] animate-spin" />
            ) : (
              <div className="w-5 h-5 rounded-full bg-white" />
            )}
          </motion.button>
        ) : (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleStop}
            className="w-16 h-16 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 shadow-[0_0_20px_rgba(0,0,0,0.5)] flex items-center justify-center border-2 border-[var(--sp-border-strong)]"
          >
            <Square className="w-5 h-5 text-red-400 fill-red-400" />
          </motion.button>
        )}
      </div>

      {/* Error toast */}
      <AnimatePresence>
        {tracking.error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-40 left-5 right-20 z-30 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2 text-xs text-red-400 pointer-events-none"
          >
            {tracking.error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Sheet */}
      <motion.div
        ref={sheetRef}
        initial={{ y: 'calc(100% - 130px)', opacity: 1 }}
        animate={{ y: sheetY, opacity: 1 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        onDragEnd={(_e, info) => {
          if (info.offset.y < -80) setSheetState('expanded');
          else if (info.offset.y < -30) setSheetState('half');
          else if (info.offset.y > 50) setSheetState('collapsed');
        }}
        className="absolute bottom-20 inset-x-0 z-40 bg-[var(--sp-bg-overlay)] backdrop-blur-2xl border-t border-[var(--sp-border-strong)] rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)] h-[85vh] flex flex-col pointer-events-auto"
      >
        <div
          className="w-full h-8 flex items-center justify-center cursor-grab active:cursor-grabbing"
          onClick={() => setSheetState(s => s === 'collapsed' ? 'expanded' : 'collapsed')}
        >
          <div className="w-12 h-1.5 bg-[var(--sp-border-strong)] rounded-full" />
        </div>

        <div className="px-6 flex-1 overflow-y-auto pb-6 custom-scrollbar">
          {/* Summary */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-[var(--sp-text-primary)] mb-1">Recent Routes</h2>
              <div className="flex items-center gap-2 text-sm text-[var(--sp-text-secondary)]">
                <span>{recentRoutes.length} route{recentRoutes.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>

          {/* Route cards */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--sp-text-muted)] uppercase tracking-wider mb-2">Route History</h3>

            {routesLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-[var(--sp-bg-input)] border border-[var(--sp-border-strong)] rounded-2xl p-3 flex gap-4 items-center animate-pulse">
                    <div className="w-20 h-20 bg-[var(--sp-bg-input)] rounded-xl shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-[var(--sp-bg-input)] rounded w-3/4" />
                      <div className="h-3 bg-[var(--sp-bg-input)] rounded w-1/2" />
                      <div className="h-3 bg-[var(--sp-bg-input)] rounded w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!routesLoading && recentRoutes.length === 0 && (
              <p className="text-sm text-slate-600 text-center py-6">
                No routes yet. Hit the red button to start exploring!
              </p>
            )}

            {recentRoutes.map((route, i) => (
              <div key={route._id} className="bg-[var(--sp-bg-input)] border border-[var(--sp-border-strong)] rounded-2xl p-3 flex gap-4 items-center">
                <div className="w-20 h-20 bg-[var(--sp-bg-overlay)] rounded-xl relative overflow-hidden shrink-0">
                  <div className="absolute inset-0 opacity-50" style={{
                    backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)`,
                    backgroundSize: '10px 10px'
                  }} />
                  <svg className="absolute inset-0 w-full h-full text-cyan-500/50" viewBox="0 0 100 100">
                    <path
                      d={`M${10 + (i * 13) % 20},${80 - (i * 7) % 30} Q${30 + (i * 11) % 25},${20 + (i * 17) % 35} ${55 + (i * 7) % 25},${45 + (i * 11) % 25} T${90 - (i * 5) % 15},${15 + (i * 13) % 30}`}
                      fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                    />
                  </svg>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-[var(--sp-text-primary)] font-medium truncate">
                      Route {route.sessionId.slice(0, 6)}
                    </h4>
                    <span className="text-xs text-[var(--sp-text-muted)] shrink-0">{routeDate(route.startedAt)}</span>
                  </div>
                  <div className="text-sm text-[var(--sp-text-secondary)] mb-2">
                    ~{((route.coordinateCount * 5) / 1000).toFixed(1)} km • {routeDuration(route.startedAt, route.endedAt)}
                  </div>
                  {route.tags.length > 0 && (
                    <div className="flex gap-2">
                      {route.tags.map(tag => (
                        <span key={tag} className="px-2 py-1 rounded-md bg-[var(--sp-bg-input)] text-xs text-[var(--sp-text-primary)] border border-[var(--sp-border)]">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
