/**
 * src/jobs/routeWriter.job.ts
 *
 * Bull worker for asynchronous bulk GPS coordinate persistence.
 *
 * Rule 4.1:  All coordinate writes are queued — never written directly to MongoDB.
 * Rule 4.2:  Retry: attempts 3, exponential backoff (1s → 2s → 4s).
 *            On final failure: log routeId + userId + errorCode + timestamp.
 *            Failed jobs stay in Bull's built-in failed queue (removeOnFail: false).
 * Rule 4.3:  Never process.exit() inside a job handler — throw and let Bull retry.
 *            Concurrency is controlled by env.BULL_CONCURRENCY (default 5).
 * Rule 9.3:  No console.log — Winston logger only.
 * Rule 11:   No `any` types.
 */
import Bull from 'bull';
import { routeWriterQueue } from '../services/queue.service';
import Route from '../models/Route';
import logger from '../config/logger';
import { env } from '../config/env';
import type { RouteWriterJobData } from '../types';

/**
 * Register the Bull process handler for the routeWriterQueue.
 * Called once from server.ts during startup, after DB and Redis are connected.
 */
export function startRouteWriterWorker(): void {
  routeWriterQueue.process(
    env.BULL_CONCURRENCY,
    async (job: Bull.Job<RouteWriterJobData>): Promise<void> => {
      const { routeId, coordinates } = job.data;

      if (!coordinates || coordinates.length === 0) {
        logger.debug('[queue] Skipping job — empty coordinates', {
          jobId: job.id,
          routeId,
        });
        return;
      }

      try {
        // Bulk coordinate appending using $push with $each (Rule 5.3: no simplification)
        const result = await Route.updateOne(
          { _id: routeId },
          {
            $push: { 'geometry.coordinates': { $each: coordinates } },
            $inc: { coordinateCount: coordinates.length },
          },
        );

        if (result.matchedCount === 0) {
          throw new Error('ROUTE_NOT_FOUND');
        }

        logger.debug('[queue] Coordinates written successfully', {
          jobId: job.id,
          routeId,
          coordinateCount: coordinates.length,
        });
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        const maxAttempts = job.opts.attempts ?? 3;

        // On final failure: log full context (Rule 2.4 + Rule 4.2)
        if (job.attemptsMade >= maxAttempts - 1) {
          let userId = 'unknown';
          try {
            const route = await Route.findById(routeId)
              .select('user_id')
              .lean();
            if (route && route.user_id) {
              userId = route.user_id.toString();
            }
          } catch (_dbErr: unknown) {
            // DB lookup failure during final-failure logging — userId stays 'unknown'
          }

          logger.error('[queue] Job permanently failed after all retries', {
            routeId,
            userId,
            errorCode: error.message === 'ROUTE_NOT_FOUND'
              ? 'ROUTE_NOT_FOUND'
              : 'WRITE_FAILED',
            timestamp: new Date().toISOString(),
            error: error.message,
            stack: error.stack,
            attemptsMade: job.attemptsMade + 1,
            coordinateCount: coordinates.length,
          });
        }

        // Rule 4.3: Throw — never process.exit(). Bull handles retries.
        throw error;
      }
    },
  );

  logger.info('[queue] routeWriter worker started', {
    concurrency: env.BULL_CONCURRENCY,
  });
}

// Re-export the queue so server.ts can import it for .close() during shutdown
export { routeWriterQueue };
