/**
 * tests/setup.ts
 * Shared test infrastructure — in-memory MongoDB, mocked Redis, mocked Bull queue.
 *
 * Usage: import { connectTestDB, disconnectTestDB } from './setup';
 *        then call in beforeAll / afterAll of each test file.
 *
 * Rule 9.3: No console.log in test files.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongoServer: MongoMemoryServer;

/**
 * Set test environment variables BEFORE importing any src/ modules.
 * Must be called at the top of each test file or in a global setup.
 */
export function setTestEnv(): void {
  process.env['NODE_ENV'] = 'test';
  process.env['PORT'] = '4000';
  // Placeholder URI — passes Zod validation; overridden by connectTestDB with in-memory URI
  process.env['MONGODB_URI'] = 'mongodb://localhost:27017/route_memory_test';
  process.env['REDIS_URL'] = 'redis://localhost:6379';
  process.env['JWT_ACCESS_SECRET'] = 'test-access-secret-at-least-32-characters-long!!';
  process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret-at-least-32-characters-long!!';
  process.env['JWT_ACCESS_EXPIRY'] = '15m';
  process.env['JWT_REFRESH_EXPIRY'] = '7d';
  process.env['GPS_JUMP_THRESHOLD_METERS'] = '500';
  process.env['ROUTE_MIN_COORDINATES'] = '3';
  process.env['HEATMAP_CACHE_TTL_SECONDS'] = '300';
  process.env['SUGGESTION_CACHE_TTL_SECONDS'] = '600';
  process.env['BULL_CONCURRENCY'] = '1';
  process.env['MONGODB_SERVER_SELECTION_TIMEOUT_MS'] = '5000';
  process.env['MONGODB_SOCKET_TIMEOUT_MS'] = '45000';
}

/**
 * Start in-memory MongoDB and connect Mongoose.
 */
export async function connectTestDB(): Promise<void> {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env['MONGODB_URI'] = uri;

  await mongoose.connect(uri);
}

/**
 * Drop all collections, disconnect, and stop the in-memory server.
 */
export async function disconnectTestDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}

/**
 * Clear all documents from all collections (use between tests if needed).
 */
export async function clearTestDB(): Promise<void> {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}
