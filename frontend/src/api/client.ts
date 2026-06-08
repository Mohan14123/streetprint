/**
 * src/api/client.ts
 * Central Axios instance for all backend API calls.
 *
 * Dev:  VITE_API_URL is '' → requests go to /api/* (Vite proxy → localhost:3000)
 * Prod: VITE_API_URL is deployed backend URL → requests go to <URL>/api/*
 */
import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config/env';

const BASE_URL = config.apiUrl ? `${config.apiUrl}/api` : '/api';

export const apiClient: AxiosInstance = axios.create({
  baseURL:         BASE_URL,
  timeout:         10_000,
  withCredentials: true,   // send cookies (refresh token)
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Request interceptor — attach access token ──────────────────────────────
apiClient.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('rm_access_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// ── Response interceptor — handle 401 with token refresh ───────────────────
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject:  (err: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null): void {
  failedQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token!),
  );
  failedQueue = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retry?: boolean, _isRefreshRequest?: boolean });

    if (error.response?.status === 401 && !original?._retry && !original?._isRefreshRequest) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          if (original) original.headers.set('Authorization', `Bearer ${token}`);
          return apiClient(original!);
        });
      }

      if (original) original._retry = true;
      isRefreshing = true;

      try {
        const storedRefresh = localStorage.getItem('rm_refresh_token');
        if (!storedRefresh) {
          throw new Error('No refresh token available');
        }
        const { data } = await apiClient.post<{ data: { accessToken: string } }>('/auth/refresh', {
          refreshToken: storedRefresh,
        }, { _isRefreshRequest: true } as any);
        const newToken  = data.data.accessToken;
        localStorage.setItem('rm_access_token', newToken);
        processQueue(null, newToken);
        if (original) original.headers.set('Authorization', `Bearer ${newToken}`);
        return apiClient(original!);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('rm_access_token');
        localStorage.removeItem('rm_refresh_token');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Extract structured error code from backend response shape (Rule 6.2)
    const responseData = error.response?.data as { error?: { code?: string } } | undefined;
    if (responseData?.error?.code) {
      (error as AxiosError & { code: string }).code = responseData.error.code;
    }

    return Promise.reject(error);
  },
);
