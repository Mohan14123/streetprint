import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient } from '../api/client';
import MockAdapter from 'axios-mock-adapter';

describe('API Client', () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(apiClient);
    localStorage.clear();
  });

  afterEach(() => {
    mock.restore();
    vi.clearAllMocks();
  });

  it('should attach access token to requests if available', async () => {
    localStorage.setItem('rm_access_token', 'test-token');
    mock.onGet('/test').reply(200, { success: true });

    const res = await apiClient.get('/test');
    expect(res.config.headers?.Authorization).toBe('Bearer test-token');
  });

  it('should attempt refresh on 401', async () => {
    localStorage.setItem('rm_refresh_token', 'test-refresh');
    
    mock.onGet('/protected').replyOnce(401, {});
    mock.onPost('/auth/refresh').replyOnce(200, { data: { accessToken: 'new-token' } });
    mock.onGet('/protected').replyOnce(200, { success: true });

    const res = await apiClient.get('/protected');
    expect(res.data.success).toBe(true);
    expect(localStorage.getItem('rm_access_token')).toBe('new-token');
  });

  it('should clear tokens and redirect to login if refresh fails', async () => {
    localStorage.setItem('rm_refresh_token', 'bad-refresh');
    
    mock.onGet('/protected').replyOnce(401, {});
    mock.onPost('/auth/refresh').replyOnce(401, {});

    const originalLocation = window.location;
    delete (window as any).location;
    (window as any).location = { href: '' };

    await expect(apiClient.get('/protected')).rejects.toThrow();
    
    expect(localStorage.getItem('rm_access_token')).toBeNull();
    expect(localStorage.getItem('rm_refresh_token')).toBeNull();
    expect(window.location.href).toBe('/login');

    (window as any).location = originalLocation;
  });
  
  it('should set error code on AxiosError if provided by backend', async () => {
    mock.onGet('/error').replyOnce(400, { error: { code: 'CUSTOM_CODE' } });
    
    try {
      await apiClient.get('/error');
    } catch (err: any) {
      expect(err.code).toBe('CUSTOM_CODE');
    }
  });

  it('should throw if no refresh token is available on 401', async () => {
    mock.onGet('/protected').replyOnce(401, {});
    
    await expect(apiClient.get('/protected')).rejects.toThrow('No refresh token available');
  });
});
