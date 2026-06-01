/**
 * src/api/places.api.ts
 * Saved places API calls.
 */
import { apiClient } from './client';

export const placesApi = {
  save: (data: { label: string; lat: number; lng: number; notes?: string }) =>
    apiClient.post('/places/save', data),

  list: (visited?: boolean) =>
    apiClient.get('/places', {
      params: visited !== undefined ? { visited } : {},
    }),

  markVisited: (id: string) =>
    apiClient.patch(`/places/${id}/visited`),

  delete: (id: string) =>
    apiClient.delete(`/places/${id}`),

  update: (id: string, data: { label?: string; notes?: string; lat?: number; lng?: number }) =>
    apiClient.patch(`/places/${id}`, data),
};
