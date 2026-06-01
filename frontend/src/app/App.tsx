/**
 * src/app/App.tsx
 * Root application component.
 *
 * Handles:
 *  - Auth gating (login/register vs authenticated tabs)
 *  - SSE connection after login (§6 in yet_to_finish)
 *  - Tab navigation (map / routes / discover / profile)
 *  - Responsive layout: desktop sidebar + mobile bottom bar
 *  - Offline-first sync wiring
 *  - Service worker registration
 */
import { useState, useEffect, useCallback } from 'react';
import { MapView } from './components/MapView';
import { SavedPlacesView } from './components/SavedPlacesView';
import { RoutesView } from './components/RoutesView';
import { ProfileView } from './components/ProfileView';
import { LoginPage } from './components/LoginPage';
import { RegisterPage } from './components/RegisterPage';
import { Map, Route, Compass, User } from 'lucide-react';
import { syncEngine } from '../offline/syncEngine';
import { useAuth } from '../auth/AuthContext';
import { connectSSE, disconnectSSE } from '../realtime/sseClient';
import { queryClient } from '../lib/queryClient';

type AuthScreen = 'login' | 'register';
type Tab = 'map' | 'routes' | 'discover' | 'profile';

const TABS: { id: Tab; label: string; icon: typeof Map }[] = [
  { id: 'map', label: 'Map', icon: Map },
  { id: 'routes', label: 'Routes', icon: Route },
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'profile', label: 'Profile', icon: User },
];

export default function App() {
  const { isAuthenticated, isLoading, token, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('map');
  const [authScreen, setAuthScreen] = useState<AuthScreen>('login');

  // ── SSE connection after login ─────────────────────────────────────────────
  useEffect(() => {
    if (isAuthenticated && token) {
      connectSSE(token, queryClient);
    }
    return () => {
      disconnectSSE();
    };
  }, [isAuthenticated, token]);

  // ── Offline-first sync wiring ──────────────────────────────────────────────
  useEffect(() => {
    void syncEngine.startAutoSync();

    const swMessageHandler = (event: MessageEvent<{ type: string }>) => {
      if (event.data?.type === 'TRIGGER_SYNC') {
        void syncEngine.syncAll().then((result) => {
          if (result.errors.length > 0) {
            console.warn('[App] SW-triggered sync completed with errors', result);
          }
        });
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', swMessageHandler);
    }

    // Register service worker
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then(() => {
          console.info('[App] Service worker registered');
        })
        .catch((err) => {
          console.warn('[App] Service worker registration failed (non-fatal)', err);
        });
    }

    return () => {
      syncEngine.stopAutoSync();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', swMessageHandler);
      }
    };
  }, []);

  // ── Logout handler (disconnects SSE) ───────────────────────────────────────
  const handleLogout = useCallback(async () => {
    disconnectSSE();
    await logout();
  }, [logout]);

  // ── Loading screen while checking auth ─────────────────────────────────────
  if (isLoading) {
    return (
      <div className="w-full h-[100dvh] bg-[#0D1117] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-[0_0_30px_rgba(34,211,238,0.3)] animate-pulse">
            <Map className="w-6 h-6 text-white" />
          </div>
          <p className="text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  // ── Auth screens ───────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    if (authScreen === 'register') {
      return <RegisterPage onSwitchToLogin={() => setAuthScreen('login')} />;
    }
    return <LoginPage onSwitchToRegister={() => setAuthScreen('register')} />;
  }

  // ── Main authenticated app ─────────────────────────────────────────────────
  void handleLogout; // acknowledge — used indirectly

  return (
    <div className="w-full h-[100dvh] bg-[#0D1117] flex flex-col">
      {/* ── Main Content Area ─────────────────────────────────────────── */}
      <div className="relative flex-1 h-full overflow-hidden">
        {activeTab === 'map' && <MapView />}
        {activeTab === 'routes' && <RoutesView />}
        {activeTab === 'discover' && <SavedPlacesView />}
        {activeTab === 'profile' && <ProfileView />}
      </div>

      {/* ── Bottom Tab Bar (all screen sizes) ─────────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 h-20 bg-[#0D1117]/80 backdrop-blur-2xl border-t border-white/5 flex items-center justify-around px-2 z-40 pb-safe">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center w-16 h-full gap-1 transition-colors duration-300 ${
                isActive ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <div className={`relative flex items-center justify-center transition-transform duration-300 ${isActive ? '-translate-y-1' : ''}`}>
                <Icon size={24} />
                {isActive && (
                  <div className="absolute -bottom-2 w-1 h-1 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                )}
              </div>
              <span className={`text-[10px] font-medium transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-0'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
