/**
 * src/app/components/ProfileView.tsx
 * Profile tab — user info, real stats from API, settings, and logout.
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
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { PrivacySettingsView } from './PrivacySettingsView';
import { userApi } from '../../api/user.api';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function ProfileView() {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

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
    { label: 'Total Distance', value: statsValues.totalDistance, icon: MapPin, color: 'text-cyan-400' },
    { label: 'Routes Recorded', value: statsValues.routeCount, icon: Route, color: 'text-emerald-400' },
    { label: 'Day Streak', value: statsValues.dayStreak, icon: Flame, color: 'text-orange-400' },
  ];

  const menuItems = [
    { label: 'Privacy & Data', icon: Shield },
  ];

  return (
    <div className="w-full h-full bg-[#0D1117] flex flex-col font-sans text-slate-200 pb-20 overflow-hidden">
      {/* Header */}
      <div className="pt-12 pb-6 px-6 bg-[#0D1117] border-b border-white/5 shrink-0">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4"
        >
          {/* Avatar */}
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/20 flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.15)]">
            <User className="w-8 h-8 text-cyan-400" />
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white truncate">
              {user?.name ?? 'Explorer'}
            </h1>
            <p className="text-sm text-slate-500 truncate">{user?.email ?? ''}</p>
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
              className="bg-[#161B22] border border-white/5 rounded-2xl p-4 flex flex-col items-center text-center"
            >
              <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
              {statsLoading ? (
                <Loader2 className="w-4 h-4 text-slate-500 animate-spin mb-0.5" />
              ) : (
                <span className="text-lg font-bold text-white">{stat.value}</span>
              )}
              <span className="text-[10px] text-slate-500 mt-0.5">{stat.label}</span>
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
            <button
              key={item.label}
              onClick={() => {
                if (item.label === 'Privacy & Data') setShowPrivacy(true);
              }}
              className="w-full bg-[#161B22] border border-white/5 rounded-xl px-4 py-3.5 flex items-center gap-3 hover:bg-white/5 transition-colors"
            >
              <item.icon className="w-5 h-5 text-slate-400" />
              <span className="flex-1 text-left text-sm text-slate-300">{item.label}</span>
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
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
            className="w-full bg-red-500/10 border border-red-500/15 rounded-xl px-4 py-3.5 flex items-center justify-center gap-2 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
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
          <p className="text-xs text-slate-700">StreetPrint v0.1.0</p>
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
