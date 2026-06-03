/**
 * src/app/components/RoutesView.tsx
 * Routes tab — fetches real route history from routeApi.list()
 * and renders scrollable route cards with distance, date, duration.
 * F6: Theme-aware using CSS custom properties.
 */
import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Route, Clock, MapPin, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { routeApi } from '../../api/routes.api';

interface RouteItem {
  _id: string;
  sessionId: string;
  status: 'active' | 'completed' | 'abandoned';
  isPublic: boolean;
  tags: string[];
  coordinateCount: number;
  startedAt: string;
  endedAt?: string;
  geometry?: {
    type: string;
    coordinates: [number, number][];
  };
}

function formatDistance(coordCount: number): string {
  // Rough estimate: average ~5m between GPS coords
  const km = (coordCount * 5) / 1000;
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)} km`;
}

function formatDuration(start: string, end?: string): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const remaining = mins % 60;
  return `${hrs}h ${remaining}m`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function RoutesView() {
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    routeApi
      .list()
      .then((resp) => {
        const data = resp.data as { data: { routes: RouteItem[] } };
        setRoutes(data.data.routes ?? []);
      })
      .catch((err) => {
        const msg = (err as { response?: { data?: { error?: { message?: string } } } })
          .response?.data?.error?.message ?? 'Failed to load routes';
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  const toggleVisibility = async (id: string, current: boolean) => {
    try {
      await routeApi.toggleVisibility(id, !current);
      setRoutes((r) =>
        r.map((route) => (route._id === id ? { ...route, isPublic: !current } : route)),
      );
    } catch {
      // Silently fail — user can retry
    }
  };

  return (
    <div className="w-full h-full flex flex-col font-sans pb-20 overflow-hidden" style={{ background: 'var(--sp-bg-primary)', color: 'var(--sp-text-primary)' }}>
      {/* Header */}
      <div className="pt-12 pb-4 px-6 border-b shrink-0" style={{ background: 'var(--sp-bg-primary)', borderColor: 'var(--sp-border)' }}>
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--sp-text-primary)' }}>Route History</h1>
        <p className="text-sm" style={{ color: 'var(--sp-text-muted)' }}>
          {routes.length} route{routes.length !== 1 ? 's' : ''} recorded
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-3 max-w-4xl mx-auto w-full">
        {loading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="rounded-2xl p-4 animate-pulse" style={{ background: 'var(--sp-bg-card)', border: '1px solid var(--sp-border)' }}>
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-xl shrink-0" style={{ background: 'var(--sp-bg-skeleton)' }} />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-4 rounded w-2/3" style={{ background: 'var(--sp-bg-skeleton)' }} />
                    <div className="h-3 rounded w-1/2" style={{ background: 'var(--sp-bg-skeleton)' }} />
                    <div className="h-3 rounded w-1/3" style={{ background: 'var(--sp-bg-skeleton)' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--sp-status-danger-bg)', border: '1px solid var(--sp-status-danger-text)', color: 'var(--sp-status-danger-text)' }}>
            {error}
          </div>
        )}

        {!loading && !error && routes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--sp-bg-input)' }}>
              <Route className="w-10 h-10" style={{ color: 'var(--sp-text-faint)' }} />
            </div>
            <p className="text-lg font-medium mb-1" style={{ color: 'var(--sp-text-secondary)' }}>No routes yet</p>
            <p className="text-sm" style={{ color: 'var(--sp-text-muted)' }}>
              Start exploring! Go to the Map tab and hit Record.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {routes.map((route, idx) => (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            key={route._id}
            className="rounded-2xl p-4 group transition-colors"
            style={{ background: 'var(--sp-bg-card)', border: '1px solid var(--sp-border)' }}
          >
            <div className="flex items-start gap-4">
              {/* Mini map thumbnail */}
              <div className="w-16 h-16 rounded-xl relative overflow-hidden shrink-0" style={{ background: 'var(--sp-bg-input)' }}>
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    backgroundImage: `linear-gradient(to right, var(--sp-border-strong) 1px, transparent 1px), linear-gradient(to bottom, var(--sp-border-strong) 1px, transparent 1px)`,
                    backgroundSize: '8px 8px',
                  }}
                />
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" style={{ color: 'var(--sp-accent)' }}>
                  <path
                    d={`M${10 + (idx * 7) % 20},${80 - (idx * 5) % 30} Q${30 + (idx * 11) % 30},${20 + (idx * 3) % 40} ${60 + (idx * 7) % 20},${50 + (idx * 9) % 20} T${90 - (idx * 5) % 15},${15 + (idx * 13) % 30}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="opacity-70"
                  />
                </svg>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-sm truncate" style={{ color: 'var(--sp-text-primary)' }}>
                      Route {route.sessionId.slice(0, 6)}
                    </h3>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        route.status === 'completed'
                          ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                          : route.status === 'active'
                            ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400'
                            : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {route.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => toggleVisibility(route._id, route.isPublic)}
                      className="transition-colors"
                      style={{ color: 'var(--sp-text-muted)' }}
                      title={route.isPublic ? 'Public' : 'Private'}
                    >
                      {route.isPublic ? <Eye className="w-3.5 h-3.5 hover:text-[var(--sp-text-primary)]" /> : <EyeOff className="w-3.5 h-3.5 hover:text-[var(--sp-text-primary)]" />}
                    </button>
                    <ChevronRight className="w-4 h-4 transition-colors hover:text-[var(--sp-text-primary)]" style={{ color: 'var(--sp-text-faint)' }} />
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs mb-2" style={{ color: 'var(--sp-text-muted)' }}>
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {formatDistance(route.coordinateCount)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(route.startedAt, route.endedAt)}
                  </span>
                  <span>{formatDate(route.startedAt)}</span>
                </div>

                {route.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {route.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded text-[10px]"
                        style={{ background: 'var(--sp-bg-input)', color: 'var(--sp-text-secondary)', border: '1px solid var(--sp-border)' }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
        </div>
      </div>
    </div>
  );
}

