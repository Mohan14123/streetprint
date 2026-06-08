/// <reference types="jest" />
import { setTestEnv } from './setup';
setTestEnv();

import supertest from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { createTestUser, generateExpiredToken } from './helpers';
import { sseClients, pushToUser, broadcast, shutdownSseClients } from '../src/routes/events.routes';

let mongoServer: MongoMemoryServer;
let accessToken: string;
let userId: string;

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
  sseClients.clear();
  const user = await createTestUser(app);
  accessToken = user.accessToken;
  userId = user.userId;
});

describe('GET /events', () => {
  it('should return 401 if token is missing', async () => {
    const res = await supertest(app).get('/api/events').expect(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_MISSING');
  });

  it('should return 401 if token is expired', async () => {
    const expiredToken = generateExpiredToken(userId, 'test@example.com');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const res = await supertest(app).get(`/api/events?token=${expiredToken}`).expect(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('should connect to SSE successfully and handle push/broadcast/shutdown', (done) => {
    const req = supertest(app).get(`/api/events?token=${accessToken}`).buffer(false);
    
    req.on('response', (res) => {
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream');
      
      // We are connected. Test the helpers.
      pushToUser(userId, 'test_event', { hello: 'world' });
      broadcast('broadcast_event', { all: true });
      
      // Trigger shutdown which calls res.end()
      setTimeout(() => {
        shutdownSseClients();
      }, 50);
    });

    req.end((err) => {
      if (err) return done(err);
      done();
    });
  });
});
