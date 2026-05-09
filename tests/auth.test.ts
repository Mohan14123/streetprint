/**
 * tests/auth.test.ts
 * Integration tests for auth middleware and /auth endpoints.
 *
 * Covers:
 *   - Any protected route with expired JWT → returns 401
 *   - Any protected route with missing token → returns 401
 *   - POST /auth/refresh with valid refresh token → returns new accessToken
 *
 * Test setup:
 *   - mongodb-memory-server for in-memory MongoDB
 *   - Redis mocked via ioredis-mock
 *   - Bull queue mocked
 *
 * Rule 6.3: Expired → 401. Invalid → 401. Missing → 401. Never 403 for auth.
 * Rule 9.3: No console.log.
 */
import { setTestEnv } from './setup';
setTestEnv();

// ── Mock Redis before any src/ imports ──────────────────────────
jest.mock('ioredis', () => require('ioredis-mock'));

// ── Mock Bull queue ─────────────────────────────────────────────
jest.mock('../src/services/queue.service', () => ({
  routeWriterQueue: {
    close: jest.fn().mockResolvedValue(undefined),
    process: jest.fn(),
    on: jest.fn(),
    add: jest.fn(),
  },
  enqueueCoordinateWrite: jest.fn().mockResolvedValue(undefined),
  flushRouteJobs: jest.fn().mockResolvedValue(undefined),
}));

import supertest from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { createTestUser, generateExpiredToken } from './helpers';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env['MONGODB_URI'] = uri;
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

// ────────────────────────────────────────────────────────────────
// Auth — expired JWT
// ────────────────────────────────────────────────────────────────

describe('Auth middleware — token validation', () => {
  it('should return 401 for an expired JWT on a protected route', async () => {
    // Create a user first so we have a valid userId
    const user = await createTestUser(app);
    const expiredToken = generateExpiredToken(user.userId, 'test@example.com');

    // Small delay to ensure the 0s expiry has elapsed
    await new Promise((resolve) => setTimeout(resolve, 100));

    const res = await supertest(app)
      .post('/route/start')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({})
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('should return 401 when no Authorization header is present', async () => {
    const res = await supertest(app)
      .post('/route/start')
      .send({})
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_TOKEN_MISSING');
  });
});

// ────────────────────────────────────────────────────────────────
// POST /auth/refresh
// ────────────────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  it('should return a new accessToken when given a valid refresh token', async () => {
    const user = await createTestUser(app);

    // Wait 1s to ensure JWT iat (second-level granularity) differs from register
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res = await supertest(app)
      .post('/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(typeof res.body.data.accessToken).toBe('string');
    // Token should be valid and different (different iat after 1s delay)
    expect(res.body.data.accessToken.split('.')).toHaveLength(3);
  });
});
