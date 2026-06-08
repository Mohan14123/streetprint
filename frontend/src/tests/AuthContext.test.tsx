import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { authApi } from '../api/auth.api';

vi.mock('../api/auth.api', () => ({
  authApi: {
    refresh: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  },
}));

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should throw if useAuth is used outside provider', () => {
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth must be used within <AuthProvider>');
  });

  it('should restore session if tokens exist in localStorage', async () => {
    localStorage.setItem('rm_access_token', 'old-access');
    localStorage.setItem('rm_refresh_token', 'old-refresh');

    (authApi.refresh as any).mockResolvedValueOnce({
      data: {
        data: {
          accessToken: 'new-access',
          user: { id: '1', email: 'test@example.com', displayName: 'Test User' }
        }
      }
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(authApi.refresh).toHaveBeenCalledWith('old-refresh');
    expect(localStorage.getItem('rm_access_token')).toBe('new-access');
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.name).toBe('Test User');
    expect(result.current.isLoading).toBe(false);
  });

  it('should clear tokens if restore fails', async () => {
    localStorage.setItem('rm_access_token', 'old-access');
    localStorage.setItem('rm_refresh_token', 'old-refresh');

    (authApi.refresh as any).mockRejectedValueOnce(new Error('Expired'));

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(localStorage.getItem('rm_access_token')).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('should clear partial tokens if refresh token is missing', async () => {
    localStorage.setItem('rm_access_token', 'stale');
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(localStorage.getItem('rm_access_token')).toBeNull();
  });

  it('should handle login successfully', async () => {
    (authApi.login as any).mockResolvedValueOnce({
      data: {
        data: {
          accessToken: 'login-access',
          refreshToken: 'login-refresh',
          user: { _id: '2', email: 'login@example.com', name: 'Login User' }
        }
      }
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    
    await act(async () => {
      await result.current.login('login@example.com', 'password');
    });

    expect(authApi.login).toHaveBeenCalledWith({ email: 'login@example.com', password: 'password' });
    expect(localStorage.getItem('rm_access_token')).toBe('login-access');
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.name).toBe('Login User');
  });

  it('should handle register successfully', async () => {
    (authApi.register as any).mockResolvedValueOnce({
      data: {
        data: {
          accessToken: 'reg-access',
          refreshToken: 'reg-refresh',
          user: { _id: '3', email: 'reg@example.com', name: 'Reg User' }
        }
      }
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    
    await act(async () => {
      await result.current.register('Reg User', 'reg@example.com', 'password');
    });

    expect(authApi.register).toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('should handle logout successfully', async () => {
    (authApi.logout as any).mockResolvedValueOnce({});

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    
    // Wait for initial mount effect to clear tokens
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Now set token and call logout
    localStorage.setItem('rm_refresh_token', 'logout-refresh');
    
    await act(async () => {
      await result.current.logout();
    });

    expect(authApi.logout).toHaveBeenCalledWith('logout-refresh');
    expect(localStorage.getItem('rm_access_token')).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });
});
