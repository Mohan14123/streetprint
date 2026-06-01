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
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Square, Loader2, X, Crosshair, User, Layers } from 'lucide-react';
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
  stationary: { label: 'Still', color: 'bg-slate-500/20 text-slate-400' },
  walking:    { label: 'Walking', color: 'bg-emerald-500/20 text-emerald-400' },
  running:    { label: 'Running', color: 'bg-orange-500/20 text-orange-400' },
  driving:    { label: 'Driving', color: 'bg-purple-500/20 text-purple-400' },
};

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
}

const SEARCH_DEBOUNCE_MS = 600;

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
  const { user } = useAuth();

  const [sheetState, setSheetState] = useState<'collapsed' | 'half' | 'expanded'>('collapsed');
  const [heatmapMode, setHeatmapMode] = useState<'my-routes' | 'community' | 'unexplored'>('my-routes');

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
  const latestTrackingPosition: [number, number] | null =
    tracking.liveRoute.length > 0
      ? (() => {
          const last = tracking.liveRoute[tracking.liveRoute.length - 1];
          // liveRoute coords are [lng, lat] (GeoJSON) → reverse for Leaflet
          return [last[1], last[0]];
        })()
      : null;

  const displayPosition = latestTrackingPosition ?? userPosition;

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

  // ── Motion badge ───────────────────────────────────────────────────────────
  const motionBadge = MOTION_BADGE_MAP[tracking.currentMotionState] ?? MOTION_BADGE_MAP.walking;

  // ── Heatmap data ──────────────────────────────────────────────────────────
  const [heatmapPoints, setHeatmapPoints] = useState<HeatmapPoint[]>([]);
  const currentBoundsRef = useRef<string>('');

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

  const handleBoundsChange = useCallback((bounds: string) => {
    currentBoundsRef.current = bounds;
    void fetchHeatmap(bounds);
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
  const [currentZoom, setCurrentZoom] = useState(15);
  const handleZoomChange = useCallback((zoom: number) => {
    setCurrentZoom(zoom);
  }, []);
  const heatmapBaseRadius = (() => {
    // At zoom 15: base=30, max scale factor=120
    // At zoom 3: base=2000, max scale factor=5000
    if (currentZoom >= 15) return { base: 30, scale: 120 };
    if (currentZoom >= 12) return { base: 80, scale: 300 };
    if (currentZoom >= 9) return { base: 300, scale: 1000 };
    if (currentZoom >= 6) return { base: 1000, scale: 3000 };
    return { base: 2000, scale: 5000 };
  })();

  // ── Nominatim search ──────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFlyTarget, setSearchFlyTarget] = useState<[number, number] | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!value.trim()) {
      setSearchResults([]);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&limit=5`,
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
    setSearchQuery(result.display_name.split(',')[0]);
    setSearchResults([]);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchFlyTarget(null);
  }, []);

  // ── Re-center handler ─────────────────────────────────────────────────────
  const [recenterKey, setRecenterKey] = useState(0);
  const handleRecenter = useCallback(() => {
    setRecenterKey(k => k + 1);
  }, []);

  // ── Overpass POI Layer ─────────────────────────────────────────────────────
  const [showPOIs, setShowPOIs] = useState(false);
  const [poiData, setPOIData] = useState<OverpassPOI[]>([]);
  const poiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch POIs when bounds change and zoom >= 14
  const handlePOIBoundsChange = useCallback((boundsStr: string, zoom: number) => {
    if (!showPOIs || zoom < 14) {
      setPOIData([]);
      return;
    }
    if (poiDebounceRef.current) clearTimeout(poiDebounceRef.current);
    poiDebounceRef.current = setTimeout(async () => {
      try {
        const [west, south, east, north] = boundsStr.split(',').map(Number);
        const pois = await fetchPOIs(south, west, north, east);
        setPOIData(pois);
      } catch {
        // Non-fatal
      }
    }, 1000);
  }, [showPOIs]);

  // Re-fetch when POI toggle changes
  useEffect(() => {
    if (showPOIs && currentBoundsRef.current && currentZoom >= 14) {
      const [west, south, east, north] = currentBoundsRef.current.split(',').map(Number);
      void fetchPOIs(south, west, north, east).then(setPOIData).catch(() => { /* non-fatal */ });
    } else if (!showPOIs) {
      setPOIData([]);
    }
  }, [showPOIs, currentZoom]);

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

  // Bottom sheet Y positions
  const sheetY = sheetState === 'expanded' ? 0 : sheetState === 'half' ? 'calc(100% - 45vh)' : 'calc(100% - 130px)';

  return (
    <div className="relative w-full h-full bg-[#0D1117] overflow-hidden font-sans text-slate-200">
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
            style={{ width: '100%', height: '100%', background: '#0D1117' }}
          >
            {/* CartoDB Dark Matter tile layer (No API key needed, dark theme) */}
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              noWrap={true}
            />

            {/* Auto-follow controller */}
            <MapController position={displayPosition} isTracking={tracking.isTracking} />

            {/* Current Location Marker */}
            {displayPosition && <Marker position={displayPosition} icon={pulsingIcon} />}

            {/* Live route polyline */}
            {polylinePositions.length > 1 && (
              <Polyline
                positions={polylinePositions}
                pathOptions={{
                  color: '#22d3ee',
                  weight: 4,
                  opacity: 0.9,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            )}

            {/* Route start marker (green dot) */}
            {routeStartPosition && tracking.isTracking && (
              <CircleMarker
                center={routeStartPosition}
                radius={7}
                pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }}
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
            <ZoomTracker onZoomChange={(z) => {
              handleZoomChange(z);
              if (currentBoundsRef.current) {
                handlePOIBoundsChange(currentBoundsRef.current, z);
              }
            }} />

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
          <div className="h-12 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full flex items-center px-4 shadow-lg">
            {searchLoading ? (
              <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
            ) : (
              <Search className="w-5 h-5 text-slate-400" />
            )}
            <input
              type="text"
              placeholder="Search places, routes..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="bg-transparent border-none outline-none text-sm text-white ml-3 w-full placeholder:text-slate-500"
            />
            {searchQuery && (
              <button onClick={clearSearch} className="text-slate-500 hover:text-white ml-1">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Search results dropdown */}
          {searchResults.length > 0 && (
            <div className="absolute top-14 left-0 right-0 bg-[#161B22]/95 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl max-h-60 overflow-y-auto">
              {searchResults.map((result) => (
                <button
                  key={result.place_id}
                  onClick={() => handleSearchSelect(result)}
                  className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0"
                >
                  <p className="text-sm text-white truncate">{result.display_name.split(',')[0]}</p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{result.display_name}</p>
                </button>
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
        <div className="bg-black/50 backdrop-blur-xl border border-white/10 p-1 rounded-full flex gap-1 pointer-events-auto shadow-lg">
          {(['my-routes', 'community', 'unexplored'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setHeatmapMode(mode)}
              className={`px-4 py-2 rounded-full text-xs font-medium transition-all duration-300 capitalize ${
                heatmapMode === mode
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                  : 'text-slate-400 hover:text-white'
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
            <div className="bg-black/60 backdrop-blur-xl border border-cyan-500/20 rounded-2xl px-5 py-3 pointer-events-auto shadow-[0_0_30px_rgba(34,211,238,0.15)] flex items-center gap-5">
              {/* Distance */}
              <div className="text-center">
                <p className="text-lg font-bold text-white tabular-nums">
                  {formatDistance(tracking.distanceMeters)}
                </p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">Distance</p>
              </div>

              <div className="w-px h-8 bg-white/10" />

              {/* Elapsed Time */}
              <div className="text-center">
                <p className="text-lg font-bold text-white tabular-nums font-mono">
                  {formatElapsedTime(elapsed)}
                </p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">Time</p>
              </div>

              <div className="w-px h-8 bg-white/10" />

              {/* Motion Badge */}
              <div className="text-center">
                <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${motionBadge.color}`}>
                  {motionBadge.label}
                </span>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Motion</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Left Button Column (Re-center + POI toggle) ─────────────────── */}
      <div className="absolute bottom-36 left-5 z-30 pointer-events-auto flex flex-col gap-3">
        {/* POI Layer Toggle */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowPOIs(p => !p)}
          className={`w-12 h-12 rounded-full backdrop-blur-xl border flex items-center justify-center shadow-lg transition-colors ${
            showPOIs
              ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400'
              : 'bg-black/50 border-white/10 text-slate-400 hover:text-cyan-400'
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
          className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-xl border border-white/10 flex items-center justify-center shadow-lg text-slate-400 hover:text-cyan-400 transition-colors"
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
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            ) : (
              <div className="w-5 h-5 rounded-full bg-white" />
            )}
          </motion.button>
        ) : (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleStop}
            className="w-16 h-16 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 shadow-[0_0_20px_rgba(0,0,0,0.5)] flex items-center justify-center border-2 border-white/10"
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
        className="absolute bottom-20 inset-x-0 z-40 bg-[#161B22]/95 backdrop-blur-2xl border-t border-white/10 rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)] h-[85vh] flex flex-col pointer-events-auto"
      >
        <div
          className="w-full h-8 flex items-center justify-center cursor-grab active:cursor-grabbing"
          onClick={() => setSheetState(s => s === 'collapsed' ? 'expanded' : 'collapsed')}
        >
          <div className="w-12 h-1.5 bg-white/20 rounded-full" />
        </div>

        <div className="px-6 flex-1 overflow-y-auto pb-6 custom-scrollbar">
          {/* Summary */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">Recent Routes</h2>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span>{recentRoutes.length} route{recentRoutes.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>

          {/* Route cards */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Route History</h3>

            {routesLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-3 flex gap-4 items-center animate-pulse">
                    <div className="w-20 h-20 bg-white/5 rounded-xl shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-white/5 rounded w-3/4" />
                      <div className="h-3 bg-white/5 rounded w-1/2" />
                      <div className="h-3 bg-white/5 rounded w-1/3" />
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
              <div key={route._id} className="bg-white/5 border border-white/10 rounded-2xl p-3 flex gap-4 items-center">
                <div className="w-20 h-20 bg-black/40 rounded-xl relative overflow-hidden shrink-0">
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
                    <h4 className="text-white font-medium truncate">
                      Route {route.sessionId.slice(0, 6)}
                    </h4>
                    <span className="text-xs text-slate-500 shrink-0">{routeDate(route.startedAt)}</span>
                  </div>
                  <div className="text-sm text-slate-400 mb-2">
                    ~{((route.coordinateCount * 5) / 1000).toFixed(1)} km • {routeDuration(route.startedAt, route.endedAt)}
                  </div>
                  {route.tags.length > 0 && (
                    <div className="flex gap-2">
                      {route.tags.map(tag => (
                        <span key={tag} className="px-2 py-1 rounded-md bg-white/5 text-xs text-slate-300 border border-white/5">{tag}</span>
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
