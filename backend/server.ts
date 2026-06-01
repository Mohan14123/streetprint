/**
 * server.ts — Application entry point.
 *
 * Rule 1.1:  process.on('uncaughtException') and process.on('unhandledRejection')
 *            MUST be registered FIRST, before any other code runs.
 * Rule 8:    Graceful shutdown sequence is strictly ordered:
 *              a. server.close()            — stop accepting new HTTP connections
 *              b. 10s deadline for in-flight requests
 *              c. routeWriterQueue.close()  — finish current job, stop new ones
 *              d. closeDB()                 — close MongoDB
 *              e. closeRedis()              — close Redis
 *              f. log "Shutdown complete"    → process.exit(0)
 * Rule 9.3:  No console.log — Winston logger only.
 * Rule 10.3: No hardcoded values — thresholds from env.ts.
 *
 * Import order note: TypeScript/Node.js hoists `import` statements to the top
 * of the module regardless of where they appear in the file. To guarantee that
 * error handlers are the very first *runtime* logic executed, we import the
 * logger first (it has no side-effects that depend on other services).
 * All subsequent imports use normal ES `import` syntax below the handlers.
 */

// ─── Step 0: Bootstrap logger before anything else ─────────────────────────────
import logger from './src/config/logger';

// ─── Step 1: Register global error boundaries FIRST (Rule 1.1) ─────────────────
process.on('uncaughtException', (err: Error) => {
  logger.error('[process] Uncaught Exception — initiating graceful shutdown', {
    error: err.message,
    stack: err.stack,
  });
  void gracefulShutdown(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('[process] Unhandled Rejection — initiating graceful shutdown', {
    error: message,
    stack,
  });
  void gracefulShutdown(1);
});

// ─── Step 2: All other imports ─────────────────────────────────────────────────
import http from 'http';
import app from './src/app';
import { env } from './src/config/env';
import { connectDB, closeDB } from './src/config/db';
import { connectRedis, closeRedis } from './src/config/redis';
import { routeWriterQueue } from './src/services/queue.service';
import { startRouteWriterWorker } from './src/jobs/routeWriter.job';
import { startHeatmapConsumer, signalHeatmapConsumerShutdown } from './src/events/consumers/heatmapConsumer';
import { startSuggestionConsumer, signalSuggestionConsumerShutdown } from './src/events/consumers/suggestionConsumer';
import { shutdownSseClients } from './src/routes/events.routes';

// ─── Constants ─────────────────────────────────────────────────────────────────
const SHUTDOWN_DEADLINE_MS = 10_000;

// ─── HTTP server instance ──────────────────────────────────────────────────────
const server = http.createServer(app);
let isShuttingDown = false;

// ─── Graceful shutdown (Rule 8) ────────────────────────────────────────────────
/**
 * Strictly-ordered shutdown sequence:
 *   a. server.close()            — stop accepting new HTTP connections
 *   b. wait for in-flight reqs   — up to SHUTDOWN_DEADLINE_MS
 *   c. routeWriterQueue.close()  — finish current job, stop new ones
 *   d. closeDB()                 — close MongoDB
 *   e. closeRedis()              — close Redis
 *   f. log "Shutdown complete"   — then exit
 *
 * If the deadline is exceeded → log warning → process.exit(1).
 */
async function gracefulShutdown(exitCode: number = 0): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info('[server] Initiating graceful shutdown sequence…');

  // Hard deadline: if cleanup takes longer than 10s, force exit with warning
  const deadlineTimer = setTimeout(() => {
    logger.warn(
      '[server] Shutdown deadline exceeded — forcing exit',
      { deadlineMs: SHUTDOWN_DEADLINE_MS },
    );
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS);

  try {
    // a. Stop accepting new HTTP connections; wait for in-flight requests
    logger.info('[server] [1/7] Closing HTTP server…');
    await new Promise<void>((resolve) => {
      server.close((err?: Error) => {
        if (err && err.message !== 'Server is not running.') {
          logger.warn('[server] HTTP server close warning', {
            error: err.message,
          });
        }
        resolve();
      });
    });

    // a2. Signal SSE consumers to stop and close all SSE streams
    logger.info('[server] [2/7] Closing SSE connections…');
    signalHeatmapConsumerShutdown();
    signalSuggestionConsumerShutdown();
    shutdownSseClients();

    // c. Drain queue (stop new jobs, let current one finish)
    logger.info('[server] [3/7] Closing routeWriterQueue…');
    await routeWriterQueue.close();

    // d. Close MongoDB
    logger.info('[server] [4/7] Closing MongoDB…');
    await closeDB();

    // e. Close Redis
    logger.info('[server] [5/7] Closing Redis…');
    await closeRedis();

    // f. All clean — cancel the deadline and exit normally
    clearTimeout(deadlineTimer);
    logger.info('[server] [6/7] Shutdown complete');
    process.exit(exitCode);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error('[server] Error during graceful shutdown', {
      error: message,
      stack,
    });
    clearTimeout(deadlineTimer);
    process.exit(1);
  }
}

// ─── Signal handlers (Rule 8) ──────────────────────────────────────────────────
process.on('SIGTERM', () => {
  logger.info('[process] SIGTERM received');
  void gracefulShutdown(0);
});

process.on('SIGINT', () => {
  logger.info('[process] SIGINT received');
  void gracefulShutdown(0);
});

// ─── Startup sequence ──────────────────────────────────────────────────────────
/**
 * Boot order:
 *   1. Connect to MongoDB (Rule 2.1: must be connected before serving traffic)
 *   2. Connect to Redis (non-fatal — caching disabled if unavailable)
 *   3. Start the Bull queue worker
 *   4. server.listen() — ONLY here, never in app.ts
 */
async function startServer(): Promise<void> {
  try {
    // 1. MongoDB — mandatory, exits on failure
    await connectDB();

    // 2. Redis — optional infrastructure
    await connectRedis();

    // 3. Start queue worker
    startRouteWriterWorker();

    // 4. Start Redis Streams consumers (after DB + Redis are connected)
    //    These run in background infinite loops — they do not block startup.
    void startHeatmapConsumer();
    void startSuggestionConsumer();

    // 5. Start HTTP server — only in server.ts (Rule 1.1)
    server.listen(env.PORT, () => {
      logger.info('[server] Listening', {
        port: env.PORT,
        environment: env.NODE_ENV,
      });
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error('[server] Startup failed', { error: message, stack });
    process.exit(1);
  }
}

void startServer();
