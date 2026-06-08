import { routeWriterQueue, enqueueCoordinateWrite, flushRouteJobs } from '../src/services/queue.service';
import logger from '../src/config/logger';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('Queue Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('enqueueCoordinateWrite', () => {
    it('should add a job to the queue', async () => {
      const addSpy = jest.spyOn(routeWriterQueue, 'add').mockResolvedValueOnce({} as any);

      await enqueueCoordinateWrite('route123', [[1, 2], [3, 4]]);

      expect(addSpy).toHaveBeenCalledWith(
        { routeId: 'route123', coordinates: [[1, 2], [3, 4]] },
        expect.any(Object)
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Enqueued coordinate batch'),
        expect.any(Object)
      );
      
      addSpy.mockRestore();
    });
  });

  describe('flushRouteJobs', () => {
    it('should flush successfully if no pending jobs', async () => {
      const getActiveSpy = jest.spyOn(routeWriterQueue, 'getActive').mockResolvedValueOnce([]);
      const getWaitingSpy = jest.spyOn(routeWriterQueue, 'getWaiting').mockResolvedValueOnce([]);
      const getDelayedSpy = jest.spyOn(routeWriterQueue, 'getDelayed').mockResolvedValueOnce([]);

      await flushRouteJobs('route123');

      expect(getActiveSpy).toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('All jobs flushed for route'),
        expect.any(Object)
      );

      getActiveSpy.mockRestore();
      getWaitingSpy.mockRestore();
      getDelayedSpy.mockRestore();
    });

    it('should wait for jobs to drain then return', async () => {
      // First tick: 1 job pending
      const getActiveSpy = jest.spyOn(routeWriterQueue, 'getActive')
        .mockResolvedValueOnce([{ data: { routeId: 'route123' } } as any])
        // Second tick: 0 jobs
        .mockResolvedValueOnce([]);
      
      const getWaitingSpy = jest.spyOn(routeWriterQueue, 'getWaiting').mockResolvedValue([]);
      const getDelayedSpy = jest.spyOn(routeWriterQueue, 'getDelayed').mockResolvedValue([]);

      await flushRouteJobs('route123');

      expect(getActiveSpy).toHaveBeenCalledTimes(2);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Waiting for route jobs to drain'),
        expect.any(Object)
      );

      getActiveSpy.mockRestore();
      getWaitingSpy.mockRestore();
      getDelayedSpy.mockRestore();
    });
  });

  describe('Event Listeners', () => {
    it('should handle queue error event', () => {
      const error = new Error('test error');
      routeWriterQueue.emit('error', error);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('routeWriterQueue error'),
        expect.any(Object)
      );
    });

    it('should handle completed event', () => {
      const job = { id: '1', data: { routeId: '123', coordinates: [] } };
      routeWriterQueue.emit('completed', job);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Job completed'),
        expect.any(Object)
      );
    });

    it('should handle failed event with retries left', () => {
      const job = { id: '1', data: { routeId: '123' }, attemptsMade: 1, opts: { attempts: 3 } };
      routeWriterQueue.emit('failed', job, new Error('failed'));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Job failed — will retry'),
        expect.any(Object)
      );
    });

    it('should handle failed event with NO retries left', () => {
      const job = { id: '1', data: { routeId: '123', coordinates: [] }, attemptsMade: 3, opts: { attempts: 3 } };
      routeWriterQueue.emit('failed', job, new Error('failed permanently'));
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Job permanently failed after all retries'),
        expect.any(Object)
      );
    });
  });
});
