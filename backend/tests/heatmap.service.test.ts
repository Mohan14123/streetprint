import { invalidateHeatmapCache } from '../src/services/heatmap.service';
import * as redisClient from '../src/config/redis';

jest.mock('../src/config/redis');

describe('Heatmap Service - invalidateHeatmapCache', () => {
  let mockRedis: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = {
      scan: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
    };
    (redisClient.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
    (redisClient as any).cacheAvailable = true;
  });

  it('should invalidate global cache when userId is not provided', async () => {
    mockRedis.scan
      .mockResolvedValueOnce(['10', ['heatmap:hash1:global', 'heatmap:hash2:global']])
      .mockResolvedValueOnce(['0', ['heatmap:hash3:global']]);

    await invalidateHeatmapCache();

    expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'heatmap:*', 'COUNT', 100);
    expect(mockRedis.scan).toHaveBeenCalledWith('10', 'MATCH', 'heatmap:*', 'COUNT', 100);
    expect(mockRedis.del).toHaveBeenCalledWith('heatmap:hash1:global', 'heatmap:hash2:global', 'heatmap:hash3:global');
  });

  it('should invalidate user specific cache when userId is provided', async () => {
    mockRedis.scan.mockResolvedValueOnce(['0', ['heatmap:hash1:user123']]);

    await invalidateHeatmapCache('user123');

    expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'heatmap:*:user123', 'COUNT', 100);
    expect(mockRedis.del).toHaveBeenCalledWith('heatmap:hash1:user123');
  });

  it('should not throw if scan fails', async () => {
    mockRedis.scan.mockRejectedValueOnce(new Error('Redis error'));
    
    await expect(invalidateHeatmapCache()).resolves.toBeUndefined();
  });

  it('should do nothing if cache is unavailable', async () => {
    (redisClient as any).cacheAvailable = false;
    await invalidateHeatmapCache();
    expect(mockRedis.scan).not.toHaveBeenCalled();
  });
});
