/**
 * src/config/db.ts
 * MongoDB connection with retry logic and index sync.
 * Rule 2.1: Connect before server starts; retry with exponential backoff (max 5 attempts).
 * Rule 2.2: Call Model.syncIndexes() for all models on startup — exits on failure.
 * Rule 2.3: Always apply serverSelectionTimeoutMS + socketTimeoutMS.
 */
import mongoose from 'mongoose';
import logger from './logger';
import { env } from './env';

const MAX_RETRY_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;

let reconnectAttempt = 0;
let isShuttingDown = false;

/**
 * Connect to MongoDB. Exits the process if the initial connection fails.
 */
export async function connectDB(): Promise<void> {
  const options: mongoose.ConnectOptions = {
    serverSelectionTimeoutMS: env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
    socketTimeoutMS: env.MONGODB_SOCKET_TIMEOUT_MS,
  };

  try {
    await mongoose.connect(env.MONGODB_URI, options);
    logger.info('[db] MongoDB connected successfully');
    reconnectAttempt = 0;
    await syncIndexes();
  } catch (err) {
    logger.error('[db] Initial MongoDB connection failed — exiting', { error: err });
    process.exit(1);
  }

  // Register disconnect handler for runtime reconnection
  mongoose.connection.on('disconnected', handleDisconnect);
  mongoose.connection.on('error', (err) => {
    logger.error('[db] MongoDB connection error', { error: err });
  });
}

/**
 * Sync 2dsphere and compound indexes for all registered models.
 * Rule 2.2: Exits with code 1 if index creation fails.
 */
async function syncIndexes(): Promise<void> {
  const modelNames = mongoose.modelNames();
  for (const name of modelNames) {
    const Model = mongoose.model(name);
    try {
      await Model.syncIndexes();
      logger.info(`[db] Indexes synced for model: ${name}`);
    } catch (err) {
      logger.error(`[db] FATAL: Failed to sync indexes for model ${name} — exiting`, { error: err });
      process.exit(1);
    }
  }
}

/**
 * Reconnect with exponential backoff after a runtime disconnect.
 * Rule 2.1: delays 1s, 2s, 4s, 8s — max 5 attempts. On failure → graceful shutdown.
 */
async function handleDisconnect(): Promise<void> {
  if (isShuttingDown) return;

  reconnectAttempt++;

  if (reconnectAttempt > MAX_RETRY_ATTEMPTS) {
    logger.error('[db] MongoDB reconnection failed after maximum attempts — initiating graceful shutdown');
    process.emit('SIGTERM');
    return;
  }

  const delayMs = Math.min(BASE_DELAY_MS * Math.pow(2, reconnectAttempt - 1), 8000);
  logger.warn(`[db] MongoDB disconnected. Reconnect attempt ${reconnectAttempt}/${MAX_RETRY_ATTEMPTS} in ${delayMs}ms`);

  await new Promise((resolve) => setTimeout(resolve, delayMs));

  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
      socketTimeoutMS: env.MONGODB_SOCKET_TIMEOUT_MS,
    });
    logger.info('[db] MongoDB reconnected successfully');
    reconnectAttempt = 0;
  } catch (err) {
    logger.warn('[db] Reconnection attempt failed', { attempt: reconnectAttempt, error: err });
    // handleDisconnect will be triggered again by the 'disconnected' event
  }
}

/**
 * Close the MongoDB connection cleanly during shutdown.
 * Rule 8: Graceful shutdown step 4.
 */
export async function closeDB(): Promise<void> {
  isShuttingDown = true;
  try {
    await mongoose.connection.close();
    logger.info('[db] MongoDB connection closed');
  } catch (err) {
    logger.error('[db] Error closing MongoDB connection', { error: err });
  }
}
