/**
 * tests/heatmap.test.ts
 * Integration tests for /heatmap endpoint.
 *
 * Covers:
 *   - GET /heatmap?bounds= → returns points array + generatedAt + cached
 *   - GET /heatmap (second call same bounds) → cached: true in response
 *
 * Test setup:
 *   - mongodb-memory-server for in-memory MongoDB
 *   - Redis mocked via ioredis-mock (supports GET/SET for cache testing)
 *   - Bull queue mocked
 *
 * Rule 9.3: No console.log.
 */
import { setTestEnv } from './setup';
setTestEnv();

// ── Mock Redis config to enable caching with in-memory store ────
const redisCacheStore = new Map<string, string>();
jest.mock('../src/config/redis', () => ({
  cacheAvailable: true,
  getRedisClient: jest.fn(),
  connectRedis: jest.fn().mockResolvedValue(undefined),
  closeRedis: jest.fn().mockResolvedValue(undefined),
  cacheGet: jest.fn(async (key: string) => redisCacheStore.get(key) ?? null),
  cacheSet: jest.fn(async (key: string, value: string, _ttl: number) => {
    redisCacheStore.set(key, value);
  }),
  cacheDel: jest.fn(async (...keys: string[]) => {
    for (const key of keys) redisCacheStore.delete(key);
  }),
}));

// ── Mock Bull queue ─────────────────────────────────────────────
jest.mock('../src/services/queue.service', () => {
  const Route = require('../src/models/Route').default;
  return {
    routeWriterQueue: {
      close: jest.fn().mockResolvedValue(undefined),
      process: jest.fn(),
      on: jest.fn(),
      add: jest.fn(),
    },
    enqueueCoordinateWrite: jest.fn(
      async (routeId: string, coordinates: [number, number][]) => {
        await Route.updateOne(
          { _id: routeId },
          {
            $push: { 'geometry.coordinates': { $each: coordinates } },
            $inc: { coordinateCount: coordinates.length },
          },
        );
      },
    ),
    flushRouteJobs: jest.fn().mockResolvedValue(undefined),
  };
});

import supertest from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { createTestUser, TEST_COORDS } from './helpers';

let mongoServer: MongoMemoryServer;
let accessToken: string;

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
  // Clear both DB and cache between tests
  redisCacheStore.clear();
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }

  // Create user and a completed route with coordinates inside the test bounds
  const user = await createTestUser(app);
  accessToken = user.accessToken;

  // Create and complete a route so heatmap has data
  const startRes = await supertest(app)
    .post('/api/route/start')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({})
    .expect(201);

  const { sessionId } = startRes.body.data;

  await supertest(app)
    .post('/api/route/update')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ sessionId, coordinates: TEST_COORDS.validSequence })
    .expect(200);

  await supertest(app)
    .post('/api/route/end')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ sessionId })
    .expect(200);
});

// ────────────────────────────────────────────────────────────────
// GET /heatmap?bounds=
// ────────────────────────────────────────────────────────────────

describe('GET /heatmap', () => {
  it('should return points array, generatedAt, and cached fields', async () => {
    const res = await supertest(app)
      .get(`/api/heatmap?bounds=${TEST_COORDS.boundsString}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('points');
    expect(res.body.data).toHaveProperty('generatedAt');
    expect(res.body.data).toHaveProperty('cached');
    expect(Array.isArray(res.body.data.points)).toBe(true);
    expect(typeof res.body.data.generatedAt).toBe('string');
    expect(typeof res.body.data.cached).toBe('boolean');
  });

  it('should return cached: true on second call with same bounds', async () => {
    // First call — cache miss
    const res1 = await supertest(app)
      .get(`/api/heatmap?bounds=${TEST_COORDS.boundsString}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res1.body.data.cached).toBe(false);

    // Second call — should be from cache
    const res2 = await supertest(app)
      .get(`/api/heatmap?bounds=${TEST_COORDS.boundsString}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res2.body.data.cached).toBe(true);
  });
});
