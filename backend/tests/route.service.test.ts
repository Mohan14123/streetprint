import { filterIncomingCoordinates } from '../src/services/route.service';

describe('Route Service - filterIncomingCoordinates', () => {
  it('should accept valid coordinates', () => {
    const coords: [number, number][] = [
      [77.5946, 12.9716],
      [77.5950, 12.9720]
    ];
    const result = filterIncomingCoordinates(coords);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toBe(0);
  });

  it('should reject invalid WGS84 coordinates', () => {
    const coords: [number, number][] = [
      [77.5946, 12.9716],
      [200, 95] // invalid
    ];
    const result = filterIncomingCoordinates(coords);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toBe(1);
  });

  it('should reject jump coordinates', () => {
    const coords: [number, number][] = [
      [77.5946, 12.9716],
      [77.6946, 13.0716] // > 500m jump
    ];
    const result = filterIncomingCoordinates(coords);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toBe(1);
  });

  it('should reject duplicate/stationary coordinates', () => {
    const coords: [number, number][] = [
      [77.5946, 12.9716],
      [77.5946, 12.9716] // duplicate
    ];
    const result = filterIncomingCoordinates(coords);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toBe(1);
  });
});

import { getUserRoutes } from '../src/services/route.service';
import Route from '../src/models/Route';

jest.mock('../src/models/Route', () => {
  return {
    find: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([{ _id: '1', user_id: 'user123' }])
  };
});

describe('Route Service - getUserRoutes', () => {
  it('should return user routes excluding active routes', async () => {
    const result = await getUserRoutes('user123', 10);
    expect(Route.find).toHaveBeenCalledWith(
      { user_id: 'user123', status: { $in: ['completed', 'abandoned'] } },
      { 'geometry.coordinates': 0 }
    );
    expect(result).toHaveLength(1);
  });
});
