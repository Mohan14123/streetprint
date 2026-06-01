/**
 * src/api/routes.api.ts
 * Route tracking API calls.
 */
import { apiClient } from './client';

export const routeApi = {
  start: () =>
    apiClient.post('/route/start'),

  update: (data: { sessionId: string; coordinates: [number, number][] }) =>
    apiClient.post('/route/update', data),

  end: (data: { sessionId: string; tags?: string[] }) =>
    apiClient.post('/route/end', data),

  list: () =>
    apiClient.get('/route'),

  getById: (id: string) =>
    apiClient.get(`/route/${id}`),

  toggleVisibility: (id: string, isPublic: boolean) =>
    apiClient.patch(`/route/${id}/visibility`, { isPublic }),
};
