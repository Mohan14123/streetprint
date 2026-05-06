import { routeWriterQueue } from '../services/queue.service';
import Route from '../models/Route';
import logger from '../config/logger';
import { env } from '../config/env';

export function startRouteWriterWorker(): void {
  routeWriterQueue.process(env.BULL_CONCURRENCY, async (job) => {
    const { routeId, coordinates } = job.data;

    try {
      if (!coordinates || coordinates.length === 0) {
        return;
      }

      // Bulk coordinate appending using $push with $each
      const result = await Route.updateOne(
        { _id: routeId },
        {
          $push: { 'geometry.coordinates': { $each: coordinates } },
          $inc: { coordinateCount: coordinates.length },
        }
      );

      if (result.matchedCount === 0) {
        throw new Error(`ROUTE_NOT_FOUND`);
      }
    } catch (err: any) {
      // Final failure check before it permanently fails
      const maxAttempts = job.opts.attempts ?? 3;
      if (job.attemptsMade >= maxAttempts - 1) {
        let userId = 'unknown';
        try {
          const route = await Route.findById(routeId).select('user_id').lean();
          if (route && route.user_id) {
            userId = route.user_id.toString();
          }
        } catch (dbErr) {
          // Ignore DB error during final failure logging
        }
        
        logger.error('[queue] Job permanently failed after all retries', {
          routeId,
          userId,
          errorCode: 'WRITE_FAILED',
          timestamp: new Date().toISOString(),
          error: err.message,
          stack: err.stack,
        });
      }

      // Rule: failed job handler must throw, never process.exit()
      throw err;
    }
  });

  logger.info('[queue] routeWriter worker started', { concurrency: env.BULL_CONCURRENCY });
}
