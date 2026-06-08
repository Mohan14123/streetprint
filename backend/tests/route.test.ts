/// <reference types="jest" />
/**
 * tests/route.test.ts
 * Integration tests for /route endpoints.
 *
 * Covers:
 *   - POST /route/start → creates session, returns sessionId + routeId
 *   - POST /route/update → correctly filters noisy GPS point (rejected: 1)
 *   - POST /route/end → abandons route when < 3 valid coordinates
 *   - POST /route/end → sets status "completed" for valid route
 *
 * Test setup:
 *   - mongodb-memory-server for in-memory MongoDB
 *   - Bull queue mocked (enqueueCoordinateWrite writes directly to DB for test determinism)
 *   - Redis mocked via ioredis-mock
 *
 * Rule 9.3: No console.log.
 */
import { setTestEnv } from './setup';
setTestEnv();

// ── Mock Redis before any src/ imports ──────────────────────────
jest.mock('ioredis', () => require('ioredis-mock'));

// ── Mock Bull queue to write directly to DB (bypass real Redis queue) ──
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
        // Write directly for test determinism instead of queueing
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
  // Clear all collections between tests
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
  // Create a fresh user for each test
  const user = await createTestUser(app);
  accessToken = user.accessToken;
});

// ────────────────────────────────────────────────────────────────
// POST /route/start
// ────────────────────────────────────────────────────────────────

describe('POST /route/start', () => {
  it('should create a session and return sessionId + routeId', async () => {
    const res = await supertest(app)
      .post('/api/route/start')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('sessionId');
    expect(res.body.data).toHaveProperty('routeId');
    expect(typeof res.body.data.sessionId).toBe('string');
    expect(typeof res.body.data.routeId).toBe('string');
    // Verify UUID format for sessionId
    expect(res.body.data.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

// ────────────────────────────────────────────────────────────────
// POST /route/update — GPS noise filtering
// ────────────────────────────────────────────────────────────────

describe('POST /route/update', () => {
  it('should reject a noisy GPS point that exceeds 500m jump threshold', async () => {
    // Start a route session first
    const startRes = await supertest(app)
      .post('/api/route/start')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);

    const { sessionId } = startRes.body.data;

    // Send a batch with 2 valid coords + 1 noisy coord (>500m jump)
    const coordinates: [number, number][] = [
      TEST_COORDS.validSequence[0],  // Valid starting point
      TEST_COORDS.noisyPoint,         // ~10km away → should be rejected
      TEST_COORDS.validSequence[1],  // Back near start → also rejected (>500m from noisy, but noisy was rejected so prev is still [0])
    ];

    const res = await supertest(app)
      .post('/api/route/update')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sessionId, coordinates })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('accepted');
    expect(res.body.data).toHaveProperty('rejected');
    // The noisy point should be rejected
    expect(res.body.data.rejected).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────
// POST /route/end — abandoned route (< 3 valid coordinates)
// ────────────────────────────────────────────────────────────────

describe('POST /route/end', () => {
  it('should set status to "abandoned" when route has < 3 valid coordinates', async () => {
    // Start a session
    const startRes = await supertest(app)
      .post('/api/route/start')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);

    const { sessionId } = startRes.body.data;

    // Send only 2 valid coordinates (below ROUTE_MIN_COORDINATES=3)
    await supertest(app)
      .post('/api/route/update')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        sessionId,
        coordinates: [
          TEST_COORDS.validSequence[0],
          TEST_COORDS.validSequence[1],
        ],
      })
      .expect(200);

    // End the route
    const endRes = await supertest(app)
      .post('/api/route/end')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sessionId })
      .expect(200);

    expect(endRes.body.success).toBe(true);
    expect(endRes.body.data.status).toBe('abandoned');
  });

  it('should set status to "completed" for a valid route with >= 3 coordinates', async () => {
    // Start a session
    const startRes = await supertest(app)
      .post('/api/route/start')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);

    const { sessionId } = startRes.body.data;

    // Send 5 valid coordinates (above ROUTE_MIN_COORDINATES=3)
    await supertest(app)
      .post('/api/route/update')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        sessionId,
        coordinates: TEST_COORDS.validSequence,
      })
      .expect(200);

    // End the route with tags
    const endRes = await supertest(app)
      .post('/api/route/end')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sessionId, tags: ['exploration'] })
      .expect(200);

    expect(endRes.body.success).toBe(true);
    expect(endRes.body.data.status).toBe('completed');
    expect(endRes.body.data.coordinateCount).toBe(5);
    expect(endRes.body.data.tags).toContain('exploration');
  });
});
