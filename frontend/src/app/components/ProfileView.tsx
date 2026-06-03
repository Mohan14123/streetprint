/**
 * src/app/components/ProfileView.tsx
 * Profile tab — user info, real stats from API, settings, and logout.
 * F6: Includes appearance/theme toggle (Dark/Light/System).
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User,
  LogOut,
  MapPin,
  Route,
  Flame,
  Shield,
  ChevronRight,
  Loader2,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { PrivacySettingsView } from './PrivacySettingsView';
import { userApi } from '../../api/user.api';
import { useTheme } from '../../hooks/useTheme';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function ProfileView() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [loggingOut, setLoggingOut] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);

  // ── Stats from API ─────────────────────────────────────────────────────────
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsValues, setStatsValues] = useState<{
    totalDistance: string;
    routeCount: string;
    dayStreak: string;
  }>({ totalDistance: '—', routeCount: '—', dayStreak: '—' });

  useEffect(() => {
    userApi
      .getStats()
      .then((resp) => {
        const data = resp.data as {
          data: {
            stats: {
              totalDistanceMeters: number;
              routeCount: number;
              dayStreak: number;
              placesCount: number;
            };
          };
        };
        const s = data.data.stats;
        setStatsValues({
          totalDistance: formatDistance(s.totalDistanceMeters),
          routeCount: String(s.routeCount),
          dayStreak: s.dayStreak > 0 ? `${s.dayStreak}d` : '0',
        });
      })
      .catch(() => {
        // Non-fatal — show placeholders
      })
      .finally(() => setStatsLoading(false));
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
  };

  const stats = [
    { label: 'Total Distance', value: statsValues.totalDistance, icon: MapPin, color: 'var(--sp-accent-text)' },
    { label: 'Routes Recorded', value: statsValues.routeCount, icon: Route, color: '#22c55e' },
    { label: 'Day Streak', value: statsValues.dayStreak, icon: Flame, color: '#f97316' },
  ];

  const themeOptions: { id: string; label: string; icon: typeof Sun }[] = [
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'system', label: 'System', icon: Monitor },
  ];

  const menuItems = [
    { label: 'Appearance', icon: theme === 'light' ? Sun : Moon, action: () => setShowAppearance(v => !v) },
    { label: 'Privacy & Data', icon: Shield, action: () => setShowPrivacy(true) },
  ];

  return (
    <div className="w-full h-full flex flex-col font-sans pb-20 overflow-hidden" style={{ background: 'var(--sp-bg-primary)', color: 'var(--sp-text-primary)' }}>
      {/* Header */}
      <div className="pt-12 pb-6 px-6 border-b shrink-0" style={{ background: 'var(--sp-bg-primary)', borderColor: 'var(--sp-border)' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4"
        >
          {/* Avatar */}
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--sp-accent-glow)', border: '1px solid var(--sp-border-strong)' }}>
            <User className="w-8 h-8" style={{ color: 'var(--sp-accent-text)' }} />
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate" style={{ color: 'var(--sp-text-primary)' }}>
              {user?.name ?? 'Explorer'}
            </h1>
            <p className="text-sm truncate" style={{ color: 'var(--sp-text-muted)' }}>{user?.email ?? ''}</p>
          </div>
        </motion.div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
        {/* Stats Grid */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-3 gap-3"
        >
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl p-4 flex flex-col items-center text-center"
              style={{ background: 'var(--sp-bg-card)', border: '1px solid var(--sp-border)' }}
            >
              <stat.icon className="w-5 h-5 mb-2" style={{ color: stat.color }} />
              {statsLoading ? (
                <Loader2 className="w-4 h-4 animate-spin mb-0.5" style={{ color: 'var(--sp-text-muted)' }} />
              ) : (
                <span className="text-lg font-bold" style={{ color: 'var(--sp-text-primary)' }}>{stat.value}</span>
              )}
              <span className="text-[10px] mt-0.5" style={{ color: 'var(--sp-text-muted)' }}>{stat.label}</span>
            </div>
          ))}
        </motion.div>

        {/* Menu Items */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-2"
        >
          {menuItems.map((item) => (
            <div key={item.label}>
              <button
                onClick={item.action}
                className="w-full rounded-xl px-4 py-3.5 flex items-center gap-3 transition-colors hover:opacity-80"
                style={{ background: 'var(--sp-bg-card)', border: '1px solid var(--sp-border)' }}
              >
                <item.icon className="w-5 h-5" style={{ color: 'var(--sp-text-secondary)' }} />
                <span className="flex-1 text-left text-sm" style={{ color: 'var(--sp-text-secondary)' }}>{item.label}</span>
                <ChevronRight className="w-4 h-4" style={{ color: 'var(--sp-text-faint)' }} />
              </button>

              {/* Appearance Theme Picker (inline under menu item) */}
              {item.label === 'Appearance' && showAppearance && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 rounded-xl p-3 flex gap-2"
                  style={{ background: 'var(--sp-bg-card)', border: '1px solid var(--sp-border)' }}
                >
                  {themeOptions.map((opt) => {
                    const isActive = theme === opt.id;
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => setTheme(opt.id)}
                        className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-lg transition-all"
                        style={{
                          background: isActive ? 'var(--sp-accent-glow)' : 'transparent',
                          border: isActive ? '1px solid var(--sp-accent-text)' : '1px solid transparent',
                          color: isActive ? 'var(--sp-accent-text)' : 'var(--sp-text-muted)',
                        }}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-[11px] font-medium">{opt.label}</span>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </div>
          ))}
        </motion.div>

        {/* Logout */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full rounded-xl px-4 py-3.5 flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            style={{
              background: 'var(--sp-status-danger-bg)',
              border: '1px solid var(--sp-status-danger-text)',
              color: 'var(--sp-status-danger-text)',
            }}
          >
            {loggingOut ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <LogOut className="w-5 h-5" />
            )}
            <span className="text-sm font-medium">
              {loggingOut ? 'Signing out...' : 'Sign Out'}
            </span>
          </button>
        </motion.div>

        {/* Version */}
        <div className="text-center pt-4">
          <p className="text-xs" style={{ color: 'var(--sp-text-faint)' }}>StreetPrint v0.1.0</p>
        </div>
      </div>

      {/* Privacy Settings Modal */}
      <AnimatePresence>
        {showPrivacy && (
          <PrivacySettingsView
            onClose={() => setShowPrivacy(false)}
            onLogout={logout}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
