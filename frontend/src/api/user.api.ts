/**
 * src/api/user.api.ts
 * User account API calls — data export, account deletion, stats.
 */
import { apiClient } from './client';

export const userApi = {
  /** GET /user/export — Download all user data (GDPR) */
  exportData: () =>
    apiClient.get('/user/export'),

  /** DELETE /user — Permanently delete account (cascading) */
  deleteAccount: () =>
    apiClient.delete('/user'),

  /** GET /user/stats — Aggregate user stats */
  getStats: () =>
    apiClient.get('/user/stats'),
};
