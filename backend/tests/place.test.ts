/// <reference types="jest" />
/**
 * tests/place.test.ts
 * Integration tests for /places endpoints.
 *
 * Covers:
 *   - POST /places/save → saves a location successfully
 *   - POST /places/save (same location within 10m) → returns existing, no duplicate
 *
 * Test setup:
 *   - mongodb-memory-server for in-memory MongoDB
 *   - Redis mocked via ioredis-mock
 *   - Bull queue mocked
 *
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
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
  const user = await createTestUser(app);
  accessToken = user.accessToken;
});

// ────────────────────────────────────────────────────────────────
// POST /places/save
// ────────────────────────────────────────────────────────────────

describe('POST /places/save', () => {
  it('should save a location successfully', async () => {
    const res = await supertest(app)
      .post('/api/places/save')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(TEST_COORDS.place)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('place');
    expect(res.body.data).toHaveProperty('isDuplicate', false);
    expect(res.body.data.place.label).toBe(TEST_COORDS.place.label);
    expect(res.body.data.place.location.type).toBe('Point');
    expect(res.body.data.place.location.coordinates).toEqual([
      TEST_COORDS.place.lng,
      TEST_COORDS.place.lat,
    ]);
  });

  it('should return existing place when saving within 10m (no duplicate)', async () => {
    // First save
    const res1 = await supertest(app)
      .post('/api/places/save')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(TEST_COORDS.place)
      .expect(201);

    const firstPlaceId = res1.body.data.place._id;

    // Second save — within 10m of the first
    const res2 = await supertest(app)
      .post('/api/places/save')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(TEST_COORDS.placeDuplicate)
      .expect(200);

    expect(res2.body.success).toBe(true);
    expect(res2.body.data.isDuplicate).toBe(true);
    // Should return the same place document
    expect(res2.body.data.place._id).toBe(firstPlaceId);
  });
});
