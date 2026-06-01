/**
 * src/api/auth.api.ts
 * Authentication API calls.
 *
 * Note: Backend RegisterSchema expects `displayName`, not `name`.
 * Note: /auth/refresh and /auth/logout require `{ refreshToken }` in body.
 */
import { apiClient } from './client';

export const authApi = {
  register: (data: { email: string; password: string; displayName: string }) =>
    apiClient.post('/auth/register', data),

  login: (data: { email: string; password: string }) =>
    apiClient.post('/auth/login', data),

  refresh: (refreshToken: string) =>
    apiClient.post('/auth/refresh', { refreshToken }),

  logout: (refreshToken: string) =>
    apiClient.post('/auth/logout', { refreshToken }),
};
