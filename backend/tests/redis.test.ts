import * as redisModule from '../src/config/redis';
import Redis from 'ioredis';
import logger from '../src/config/logger';

jest.mock('ioredis');
jest.mock('../src/config/logger');

describe('Redis Configuration', () => {
  let mockRedisClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (redisModule as any).cacheAvailable = false;
    (redisModule as any).redisClient = null;

    mockRedisClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    (Redis as unknown as jest.Mock).mockImplementation(() => mockRedisClient);
  });

  describe('createRedisClient', () => {
    it('should create a Redis client and attach event listeners', () => {
      const client = redisModule.createRedisClient();
      expect(client).toBeDefined();
      expect(mockRedisClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('reconnecting', expect.any(Function));
    });

    it('should handle retryStrategy', () => {
      redisModule.createRedisClient();
      const options = (Redis as unknown as jest.Mock).mock.calls[0][1];
      const strategy = options.retryStrategy;
      
      expect(strategy(1)).toBe(500); // 1 * 500
      expect(strategy(10)).toBe(5000); // 10 * 500
      expect(strategy(11)).toBe(30000); // capped at > 10
    });

    it('should handle connect event', () => {
      redisModule.createRedisClient();
      const connectCb = mockRedisClient.on.mock.calls.find((call: any) => call[0] === 'connect')[1];
      connectCb();
      expect(logger.info).toHaveBeenCalledWith('[redis] Redis connected');
    });

    it('should handle ready event', () => {
      redisModule.createRedisClient();
      const readyCb = mockRedisClient.on.mock.calls.find((call: any) => call[0] === 'ready')[1];
      readyCb();
      expect(redisModule.cacheAvailable).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('[redis] Redis ready — caching enabled');
    });

    it('should handle error event', () => {
      redisModule.createRedisClient();
      const errorCb = mockRedisClient.on.mock.calls.find((call: any) => call[0] === 'error')[1];
      errorCb(new Error('test error'));
      expect(logger.warn).toHaveBeenCalledWith('[redis] Redis error', { message: 'test error' });
    });

    it('should handle close event', () => {
      redisModule.createRedisClient();
      const closeCb = mockRedisClient.on.mock.calls.find((call: any) => call[0] === 'close')[1];
      closeCb();
      expect(redisModule.cacheAvailable).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith('[redis] Redis connection closed — caching disabled');
    });

    it('should handle reconnecting event', () => {
      redisModule.createRedisClient();
      const reconCb = mockRedisClient.on.mock.calls.find((call: any) => call[0] === 'reconnecting')[1];
      reconCb(1000);
      expect(logger.info).toHaveBeenCalledWith('[redis] Reconnecting in 1000ms');
    });
  });

  describe('connectRedis', () => {
    it('should connect to Redis successfully', async () => {
      await redisModule.connectRedis();
      expect(mockRedisClient.connect).toHaveBeenCalled();
    });

    it('should handle connection errors gracefully', async () => {
      mockRedisClient.connect.mockRejectedValueOnce(new Error('connect error'));
      await redisModule.connectRedis();
      expect(logger.warn).toHaveBeenCalledWith(
        '[redis] Could not connect to Redis — caching will be disabled',
        { error: expect.any(Error) }
      );
      expect(redisModule.cacheAvailable).toBe(false);
    });
  });

  describe('getRedisClient', () => {
    it('should return client if initialized', () => {
      redisModule.createRedisClient();
      expect(redisModule.getRedisClient()).toBeDefined();
    });
  });

  describe('Cache Operations', () => {
    beforeEach(() => {
      redisModule.createRedisClient();
      (redisModule as any).cacheAvailable = true;
    });

    describe('cacheGet', () => {
      it('should return null if cache is unavailable', async () => {
        (redisModule as any).cacheAvailable = false;
        const res = await redisModule.cacheGet('key');
        expect(res).toBeNull();
      });

      it('should get a value', async () => {
        mockRedisClient.get.mockResolvedValueOnce('value');
        const res = await redisModule.cacheGet('key');
        expect(res).toBe('value');
      });

      it('should catch errors and return null', async () => {
        mockRedisClient.get.mockRejectedValueOnce(new Error('get error'));
        const res = await redisModule.cacheGet('key');
        expect(res).toBeNull();
        expect(logger.warn).toHaveBeenCalled();
      });
    });

    describe('cacheSet', () => {
      it('should do nothing if cache is unavailable', async () => {
        (redisModule as any).cacheAvailable = false;
        await redisModule.cacheSet('key', 'val', 10);
        expect(mockRedisClient.set).not.toHaveBeenCalled();
      });

      it('should set a value with TTL', async () => {
        await redisModule.cacheSet('key', 'val', 10);
        expect(mockRedisClient.set).toHaveBeenCalledWith('key', 'val', 'EX', 10);
      });

      it('should catch errors', async () => {
        mockRedisClient.set.mockRejectedValueOnce(new Error('set error'));
        await redisModule.cacheSet('key', 'val', 10);
        expect(logger.warn).toHaveBeenCalled();
      });
    });

    describe('cacheDel', () => {
      it('should do nothing if cache is unavailable', async () => {
        (redisModule as any).cacheAvailable = false;
        await redisModule.cacheDel('key');
        expect(mockRedisClient.del).not.toHaveBeenCalled();
      });

      it('should delete keys', async () => {
        await redisModule.cacheDel('key1', 'key2');
        expect(mockRedisClient.del).toHaveBeenCalledWith('key1', 'key2');
      });

      it('should catch errors', async () => {
        mockRedisClient.del.mockRejectedValueOnce(new Error('del error'));
        await redisModule.cacheDel('key');
        expect(logger.warn).toHaveBeenCalled();
      });
    });

    describe('closeRedis', () => {
      it('should close the connection', async () => {
        await redisModule.closeRedis();
        expect(mockRedisClient.quit).toHaveBeenCalled();
        expect(redisModule.cacheAvailable).toBe(false);
      });

      it('should handle quit errors', async () => {
        mockRedisClient.quit.mockRejectedValueOnce(new Error('quit error'));
        await redisModule.closeRedis();
        expect(logger.error).toHaveBeenCalled();
      });
    });
  });
});
