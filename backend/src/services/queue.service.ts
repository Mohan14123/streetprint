/**
 * src/services/queue.service.ts
 * Bull queue setup for batch GPS coordinate writes.
 *
 * Rule 4.1: ALL coordinate writes go through this queue — never direct to MongoDB.
 * Rule 4.2: Retry: attempts: 3, exponential backoff delay: 1000ms.
 * Rule 4.3: Worker lifecycle managed via SIGTERM handler in server.ts.
 * Rule 3.1: Redis backing — if Redis is unavailable the queue will fail to enqueue;
 *            callers catch this and handle gracefully.
 */
import Bull from 'bull';
import { env } from '../config/env';
import logger from '../config/logger';
import type { RouteWriterJobData } from '../types';
import { Gauge, Counter } from 'prom-client';

export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Number of jobs currently in the queue',
  labelNames: ['status']
});

export const queueJobsCompleted = new Counter({
  name: 'queue_jobs_completed_total',
  help: 'Total number of jobs completed successfully by the queue'
});

export const queueJobsFailed = new Counter({
  name: 'queue_jobs_failed_total',
  help: 'Total number of jobs permanently failed in the queue'
});

// ────────────────────────────────────────────────────────────────
// Queue instance (singleton)
// ────────────────────────────────────────────────────────────────

/**
 * The sole queue used for GPS coordinate persistence.
 * Configured once here; imported wherever jobs are added or processed.
 */
export const routeWriterQueue = new Bull<RouteWriterJobData>('routeWriter', {
  redis: env.REDIS_URL,
  defaultJobOptions: {
    // Rule 4.2: 3 attempts with exponential back-off (1 s, 2 s, 4 s)
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1_000,
    },
    removeOnComplete: true,
    removeOnFail: false, // Keep failed jobs visible in Bull's failed set
  },
});

// ────────────────────────────────────────────────────────────────
// Queue event logging & Metrics tracking
// ────────────────────────────────────────────────────────────────

// Poll queue depth every 5 seconds
setInterval(async () => {
  try {
    const counts = await routeWriterQueue.getJobCounts();
    queueDepth.set({ status: 'active' }, counts.active);
    queueDepth.set({ status: 'waiting' }, counts.waiting);
    queueDepth.set({ status: 'delayed' }, counts.delayed);
  } catch (err) {
    // Ignore background polling errors
  }
}, 5000);

routeWriterQueue.on('error', (err: Error) => {
  logger.error('[queue] routeWriterQueue error', { message: err.message, stack: err.stack });
});

routeWriterQueue.on('failed', (job, err: Error) => {
  // Only log at error level after ALL retries are exhausted
  if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
    queueJobsFailed.inc();
    logger.error('[queue] Job permanently failed after all retries', {
      jobId: job.id,
      routeId: job.data.routeId,
      coordinateCount: job.data.coordinates.length,
      attemptsMade: job.attemptsMade,
      error: err.message,
    });
  } else {
    logger.warn('[queue] Job failed — will retry', {
      jobId: job.id,
      routeId: job.data.routeId,
      attempt: job.attemptsMade,
      error: err.message,
    });
  }
});

routeWriterQueue.on('completed', (job) => {
  queueJobsCompleted.inc();
  logger.debug('[queue] Job completed', {
    jobId: job.id,
    routeId: job.data.routeId,
    coordinateCount: job.data.coordinates.length,
  });
});

// ────────────────────────────────────────────────────────────────
// Job Producer
// ────────────────────────────────────────────────────────────────

/**
 * Enqueue a batch of GPS coordinate pairs for persistence.
 *
 * Rule 4.1: NEVER call this with an empty coordinates array — validate before calling.
 * Rule 4.2: Job options (retries, backoff) are set on the queue's defaultJobOptions.
 *
 * @param routeId - MongoDB ObjectId string for the target Route document
 * @param coordinates - Array of [lng, lat] pairs to append
 */
export async function enqueueCoordinateWrite(
  routeId: string,
  coordinates: [number, number][],
): Promise<void> {
  const jobData: RouteWriterJobData = { routeId, coordinates };

  await routeWriterQueue.add(jobData, {
    // Job-level options inherit queue defaults; can override per-job if needed
  });

  logger.debug('[queue] Enqueued coordinate batch', {
    routeId,
    coordinateCount: coordinates.length,
  });
}

/**
 * Wait for all jobs with a specific routeId to drain before closing a session.
 * This is a best-effort flush: if the queue is large, we wait up to 10 s.
 *
 * Used by: route.service.ts → endRoute()
 */
export async function flushRouteJobs(routeId: string): Promise<void> {
  const WAIT_MS = 10_000;
  const POLL_MS = 200;
  const deadline = Date.now() + WAIT_MS;

  while (Date.now() < deadline) {
    const active = await routeWriterQueue.getActive();
    const waiting = await routeWriterQueue.getWaiting();
    const delayed = await routeWriterQueue.getDelayed();

    const pending = [...active, ...waiting, ...delayed].filter(
      (job) => job.data.routeId === routeId,
    );

    if (pending.length === 0) {
      logger.debug('[queue] All jobs flushed for route', { routeId });
      return;
    }

    logger.debug('[queue] Waiting for route jobs to drain', {
      routeId,
      remaining: pending.length,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
  }

  logger.warn('[queue] Flush timeout — some jobs may still be pending for route', { routeId });
}
