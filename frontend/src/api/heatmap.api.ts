/**
 * src/api/heatmap.api.ts
 * Heatmap API calls.
 */
import { apiClient } from './client';

export const heatmapApi = {
  get: (bounds: string, userId?: string) =>
    apiClient.get('/heatmap', {
      params: { bounds, ...(userId !== undefined && { userId }) },
    }),
};
