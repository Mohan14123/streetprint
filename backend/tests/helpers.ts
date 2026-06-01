/**
 * tests/helpers.ts
 * Shared test helpers — user creation, token generation, test data.
 *
 * Rule 9.3: No console.log.
 */
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

/**
 * Register a test user and return tokens + userId.
 */
export async function createTestUser(
  app: Application,
  email = 'test@example.com',
  password = 'TestPassword123!',
  displayName = 'Test User',
): Promise<{
  accessToken: string;
  refreshToken: string;
  userId: string;
}> {
  const res = await supertest(app)
    .post('/api/auth/register')
    .send({ email, password, displayName })
    .expect(201);

  return {
    accessToken: res.body.data.accessToken as string,
    refreshToken: res.body.data.refreshToken as string,
    userId: res.body.data.user._id as string,
  };
}

/**
 * Generate an expired JWT access token for testing auth rejection.
 */
export function generateExpiredToken(userId: string, email: string): string {
  return jwt.sign(
    { userId, email, type: 'access' },
    process.env['JWT_ACCESS_SECRET']!,
    { expiresIn: '0s' },  // Immediately expired
  );
}

/**
 * Test coordinates in Bengaluru area for route tests.
 * All in [lng, lat] GeoJSON format.
 */
export const TEST_COORDS = {
  /** Valid sequential coordinates — small movements (~50-100m apart) */
  validSequence: [
    [77.5946, 12.9716],   // MG Road
    [77.5950, 12.9720],   // ~50m north-east
    [77.5955, 12.9725],   // ~60m north-east
    [77.5960, 12.9730],   // ~60m north-east
    [77.5965, 12.9735],   // ~60m north-east
  ] as [number, number][],

  /** A noisy GPS point — 10km away from the valid sequence (exceeds 500m threshold) */
  noisyPoint: [77.7000, 13.0500] as [number, number],

  /** Valid bounds string for heatmap queries (Bengaluru area) */
  boundsString: '77.55,12.93,77.65,13.00',

  /** A valid place location */
  place: { lat: 12.9716, lng: 77.5946, label: 'Test Cafe' },

  /** Same place within 10m (for deduplication test) */
  placeDuplicate: { lat: 12.97165, lng: 77.59465, label: 'Nearby Cafe' },
};
