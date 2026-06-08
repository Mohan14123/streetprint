/**
 * src/middleware/errorHandler.ts
 * Global Express error handler — last middleware registered in app.ts.
 *
 * Rule 1.2: Must be the LAST middleware in app.ts.
 * Rule 1.2: Never send a response if headers already sent.
 * Rule 1.2: Never expose stack traces in production.
 * Rule 6.1: All error responses follow the standard envelope shape.
 * Rule 6.2: Always include a namespaced error code.
 */
import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';
import {
  sendError,
  ErrorCode,
} from '../utils/responseHelper';
import { env } from '../config/env';
import { Counter } from 'prom-client';

export const apiErrors = new Counter({
  name: 'api_errors_total',
  help: 'Total number of API errors caught by the global error handler',
  labelNames: ['status_code', 'error_code']
});

/** Shape of errors thrown from services with an attached `code` property */
interface AppError extends Error {
  code?: string;
  statusCode?: number;
}

/**
 * Global Express error handling middleware.
 * Must be registered AFTER all routes and other middleware in app.ts.
 *
 * Handles:
 * - Custom AppErrors with .code and .statusCode
 * - Mongoose validation errors
 * - Generic 500 fallback
 */
export function globalErrorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Rule 1.2: Never send after headers are already sent
  if (res.headersSent) {
    logger.error('[errorHandler] Headers already sent — cannot send error response', {
      path: req.path,
      method: req.method,
      errorMessage: err.message,
    });
    return;
  }

  // Determine status code
  const statusCode = err.statusCode ?? 500;
  const code = err.code ?? ErrorCode.INTERNAL_SERVER_ERROR;
  const message = statusCode === 500 ? 'An unexpected error occurred.' : err.message;

  // Rule 9.1: Log at 'error' level for 5xx, 'warn' for 4xx
  if (statusCode >= 500) {
    logger.error('[errorHandler] Unhandled error', {
      path: req.path,
      method: req.method,
      statusCode,
      code,
      errorMessage: err.message,
      stack: err.stack,
    });
  } else {
    logger.warn('[errorHandler] Client error', {
      path: req.path,
      method: req.method,
      statusCode,
      code,
      errorMessage: err.message,
    });
  }

  // Rule 1.2: Never include stack traces in production
  const details =
    env.NODE_ENV === 'development'
      ? { stack: err.stack, originalMessage: err.message }
      : undefined;

  apiErrors.inc({ status_code: statusCode, error_code: code });

  sendError(res, statusCode, code, message, details);
}
