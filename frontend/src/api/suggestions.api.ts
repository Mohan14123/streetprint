/**
 * src/api/suggestions.api.ts
 * Location suggestions API calls.
 */
import { apiClient } from './client';

export const suggestionsApi = {
  get: (lat: number, lng: number, radiusMeters = 2000) =>
    apiClient.get('/suggestions', {
      params: { lat, lng, radiusMeters },
    }),
};
