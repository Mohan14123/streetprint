/// <reference types="jest" />
import { setTestEnv, connectTestDB, disconnectTestDB, clearTestDB } from './setup';
setTestEnv();

import mongoose from 'mongoose';
import { getSuggestions } from '../src/services/suggestion.service';
import Route from '../src/models/Route';
import { cacheGet, cacheSet } from '../src/config/redis';
import { createTestUser } from './helpers';
import app from '../src/app';
import supertest from 'supertest';

jest.mock('../src/config/redis', () => ({
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
  cacheDel: jest.fn(),
  getRedisClient: jest.fn(),
  cacheAvailable: true,
}));

describe('Suggestion Service (Grid-based)', () => {
  let userId: string;
  const centerLat = 12.9716;
  const centerLng = 77.5946;

  beforeAll(async () => {
    await connectTestDB();
    const user = await createTestUser(app);
    userId = user.userId;
  });

  afterAll(async () => {
    await clearTestDB();
    await disconnectTestDB();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return cached suggestions if available', async () => {
    const mockCached = {
      unexploredZones: [{ type: 'Point', coordinates: [77.6, 12.98] }],
      popularNearbyRoutes: []
    };
    (cacheGet as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockCached));

    const result = await getSuggestions(userId, centerLat, centerLng, 2000);

    expect(cacheGet).toHaveBeenCalledWith(`suggestions:${userId}:${centerLat.toFixed(4)}:${centerLng.toFixed(4)}`);
    expect(result).toEqual(mockCached);
  });

  it('should compute grid-based unexplored zones and popular routes', async () => {
    (cacheGet as jest.Mock).mockResolvedValueOnce(null);

    // Create a nearby route for the user
    await Route.create({
      user_id: new mongoose.Types.ObjectId(userId),
      sessionId: 'user-session',
      status: 'completed',
      geometry: { type: 'LineString', coordinates: [[77.5946, 12.9716], [77.5947, 12.9717]] },
      coordinateCount: 2,
      startedAt: new Date(),
      isPublic: true
    });

    // Create a nearby community route
    const communityRoute = await Route.create({
      user_id: new mongoose.Types.ObjectId(), // Different user
      sessionId: 'community-session',
      status: 'completed',
      geometry: { type: 'LineString', coordinates: [[77.595, 12.972], [77.5951, 12.9721]] },
      coordinateCount: 5,
      startedAt: new Date(),
      isPublic: true
    });

    const result = await getSuggestions(userId, centerLat, centerLng, 2000);

    // Unexplored zones
    expect(result.unexploredZones).toBeInstanceOf(Array);
    
    // Popular nearby routes
    expect(result.popularNearbyRoutes).toHaveLength(1);
    expect(result.popularNearbyRoutes[0].routeId.toString()).toBe(communityRoute._id.toString());
    
    expect(cacheSet).toHaveBeenCalled();
  });

  it('should throw an error for invalid coordinates', async () => {
    await expect(getSuggestions(userId, 95, 200, 2000)).rejects.toThrow(/Invalid WGS84 coordinates/);
  });
  it('should return suggestions from controller', async () => {
    const user = await createTestUser(app, 'sugg-ctrl@example.com');
    const res = await supertest(app)
      .get('/api/suggestions?lat=12.9716&lng=77.5946&radius=2000')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('unexploredZones');
    expect(res.body.data).toHaveProperty('popularNearbyRoutes');
  });

  it('should fail with invalid query parameters', async () => {
    const user = await createTestUser(app, 'sugg-ctrl2@example.com');
    const res = await supertest(app)
      .get('/api/suggestions?lat=900&lng=77.5946')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(400);
    expect(res.body.success).toBe(false);
  });
});
