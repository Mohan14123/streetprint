/// <reference types="jest" />
import { setTestEnv, connectTestDB, disconnectTestDB, clearTestDB } from './setup';
setTestEnv();

import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app';
import User from '../src/models/User';
import Route from '../src/models/Route';
import Place from '../src/models/Place';
import * as redis from '../src/config/redis';
import { createTestUser } from './helpers';

jest.mock('../src/config/redis', () => ({
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
  cacheDel: jest.fn(),
  getRedisClient: jest.fn().mockReturnValue({
    keys: jest.fn().mockResolvedValue(['session:refresh:123']),
    del: jest.fn().mockResolvedValue(1)
  }),
  cacheAvailable: true,
}));

describe('User API', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    await connectTestDB();
    const user = await createTestUser(app);
    userId = user.userId;
    token = user.accessToken;
  });

  afterAll(async () => {
    await clearTestDB();
    await disconnectTestDB();
  });

  describe('GET /api/user/stats', () => {
    it('should return user stats', async () => {
      await Route.create({
        user_id: new mongoose.Types.ObjectId(userId),
        sessionId: 'test-session-1',
        status: 'completed',
        geometry: { type: 'LineString', coordinates: [[77.59, 12.97], [77.591, 12.971], [77.592, 12.972]] },
        coordinateCount: 3,
        startedAt: new Date(Date.now() - 86400000),
        endedAt: new Date(),
        isPublic: true,
        isPolylineEncoded: false
      });

      const res = await request(app)
        .get('/api/user/stats')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stats.routeCount).toBe(1);
      expect(res.body.data.stats.totalDistanceMeters).toBe(15);
      expect(res.body.data.stats.dayStreak).toBeDefined();
    });
  });

  describe('GET /api/user/export', () => {
    it('should export all user data', async () => {
      await Place.create({
        user_id: new mongoose.Types.ObjectId(userId),
        label: 'Test Place',
        location: { type: 'Point', coordinates: [77.59, 12.97] }
      });

      const res = await request(app)
        .get('/api/user/export')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('test@example.com');
      expect(res.body.data.routes).toHaveLength(1);
      expect(res.body.data.places).toHaveLength(1);
    });
  });

  describe('DELETE /api/user', () => {
    it('should delete user and all associated data', async () => {
      const res = await request(app)
        .delete('/api/user')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const user = await User.findById(userId);
      const routes = await Route.find({ user_id: userId });
      const places = await Place.find({ user_id: userId });

      expect(user).toBeNull();
      expect(routes).toHaveLength(0);
      expect(places).toHaveLength(0);
      expect(redis.getRedisClient).toHaveBeenCalled();
    });
  });
});
