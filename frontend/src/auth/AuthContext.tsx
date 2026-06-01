/**
 * src/auth/AuthContext.tsx
 * Authentication context — manages JWT tokens, user state, and auth flow.
 *
 * Token storage:
 *   - Access token:  localStorage key `rm_access_token`
 *   - Refresh token: localStorage key `rm_refresh_token`
 *
 * On mount: attempts silent refresh to restore session.
 * On 401: apiClient interceptor calls /auth/refresh automatically.
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { authApi } from '../api/auth.api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Backend returns { displayName } but frontend User type uses { name }. Map it. */
function mapBackendUser(raw: Record<string, unknown>): User {
  return {
    id: String(raw._id ?? raw.id ?? ''),
    email: String(raw.email ?? ''),
    name: String(raw.displayName ?? raw.name ?? ''),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    refreshToken: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // ── Attempt session restore on mount ───────────────────────────────────────
  useEffect(() => {
    const existingToken = localStorage.getItem('rm_access_token');
    const existingRefresh = localStorage.getItem('rm_refresh_token');

    if (existingToken && existingRefresh) {
      // Try to refresh the session to validate the token
      authApi
        .refresh(existingRefresh)
        .then((resp) => {
          const data = resp.data as {
            data: { accessToken: string; user?: Record<string, unknown> };
          };
          const newToken = data.data.accessToken;
          localStorage.setItem('rm_access_token', newToken);
          // refresh endpoint may or may not return user — keep existing info
          const user = data.data.user
            ? mapBackendUser(data.data.user)
            : null;
          setState({
            user,
            token: newToken,
            refreshToken: existingRefresh,
            isAuthenticated: true,
            isLoading: false,
          });
        })
        .catch(() => {
          // Refresh failed — clear stale tokens
          localStorage.removeItem('rm_access_token');
          localStorage.removeItem('rm_refresh_token');
          setState({
            user: null,
            token: null,
            refreshToken: null,
            isAuthenticated: false,
            isLoading: false,
          });
        });
    } else {
      // No tokens — clear any stale partial state
      localStorage.removeItem('rm_access_token');
      localStorage.removeItem('rm_refresh_token');
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, []);

  // ── Login ──────────────────────────────────────────────────────────────────
  const login = useCallback(async (email: string, password: string) => {
    const resp = await authApi.login({ email, password });
    const data = resp.data as {
      data: {
        accessToken: string;
        refreshToken: string;
        user: Record<string, unknown>;
      };
    };
    const token = data.data.accessToken;
    const refresh = data.data.refreshToken;
    localStorage.setItem('rm_access_token', token);
    localStorage.setItem('rm_refresh_token', refresh);
    setState({
      user: mapBackendUser(data.data.user),
      token,
      refreshToken: refresh,
      isAuthenticated: true,
      isLoading: false,
    });
  }, []);

  // ── Register ───────────────────────────────────────────────────────────────
  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const resp = await authApi.register({ email, password, displayName: name });
      const data = resp.data as {
        data: {
          accessToken: string;
          refreshToken: string;
          user: Record<string, unknown>;
        };
      };
      const token = data.data.accessToken;
      const refresh = data.data.refreshToken;
      localStorage.setItem('rm_access_token', token);
      localStorage.setItem('rm_refresh_token', refresh);
      setState({
        user: mapBackendUser(data.data.user),
        token,
        refreshToken: refresh,
        isAuthenticated: true,
        isLoading: false,
      });
    },
    [],
  );

  // ── Logout ─────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    const refresh = localStorage.getItem('rm_refresh_token');
    try {
      if (refresh) {
        await authApi.logout(refresh);
      }
    } catch {
      // Swallow — server may be unreachable
    }
    localStorage.removeItem('rm_access_token');
    localStorage.removeItem('rm_refresh_token');
    setState({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{ ...state, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

