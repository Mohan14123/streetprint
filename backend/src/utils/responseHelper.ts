/**
 * src/utils/responseHelper.ts
 * Standardized API response shapes — pure utility, no side effects.
 * Rule 6.1: All responses must follow the standard envelope shape.
 * Rule 6.2: Error codes are namespaced string constants.
 * Rule 11: All utility functions must be pure.
 */
import { Response } from 'express';
import { randomUUID } from 'crypto';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface ApiMeta {
  requestId: string;
  timestamp: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  error: null;
  meta: ApiMeta;
}

export interface ApiError {
  success: false;
  data: null;
  error: {
    code: string;
    message: string;
    /** Included only in development mode (never in production) */
    details?: unknown;
  };
  meta: ApiMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ────────────────────────────────────────────────────────────────
// Namespaced Error Codes (Rule 6.2)
// ────────────────────────────────────────────────────────────────

export const ErrorCode = {
  // Auth
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_CREDENTIALS_INVALID: 'AUTH_CREDENTIALS_INVALID',
  AUTH_USER_NOT_FOUND: 'AUTH_USER_NOT_FOUND',
  AUTH_EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',

  // Route
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  ROUTE_SESSION_NOT_FOUND: 'ROUTE_SESSION_NOT_FOUND',
  ROUTE_SESSION_NOT_OWNED: 'ROUTE_SESSION_NOT_OWNED',
  SESSION_ALREADY_ACTIVE: 'SESSION_ALREADY_ACTIVE',

  // GPS / Spatial
  GPS_INVALID: 'GPS_INVALID',
  GPS_BOUNDS_INVALID: 'GPS_BOUNDS_INVALID',
  GPS_COORDINATES_REQUIRED: 'GPS_COORDINATES_REQUIRED',

  // Places
  PLACE_NOT_FOUND: 'PLACE_NOT_FOUND',
  PLACE_DUPLICATE: 'PLACE_DUPLICATE',

  // General
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// ────────────────────────────────────────────────────────────────
// Meta Builder
// ────────────────────────────────────────────────────────────────

/**
 * Build the `meta` block attached to every response.
 * The requestId should be generated once per request in middleware
 * and attached to `res.locals.requestId`.
 */
export function buildMeta(requestId?: string): ApiMeta {
  return {
    requestId: requestId ?? randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────
// Success Response
// ────────────────────────────────────────────────────────────────

/**
 * Send a standardized success response.
 *
 * @param res - Express Response object
 * @param data - Payload to return in `data`
 * @param statusCode - HTTP status code (default: 200)
 * @param requestId - Optional request ID from res.locals
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  requestId?: string,
): void {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    error: null,
    meta: buildMeta(requestId ?? (res.locals.requestId as string | undefined)),
  };
  res.status(statusCode).json(body);
}

// ────────────────────────────────────────────────────────────────
// Error Response
// ────────────────────────────────────────────────────────────────

/**
 * Send a standardized error response.
 * Rule 1.2: Never include stack traces in production.
 *
 * @param res - Express Response object
 * @param statusCode - HTTP status code
 * @param code - Namespaced error code string (from ErrorCode)
 * @param message - Human-readable error message
 * @param details - Optional debug details (only included in development)
 */
export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  const isDevMode = process.env['NODE_ENV'] === 'development';

  const body: ApiError = {
    success: false,
    data: null,
    error: {
      code,
      message,
      ...(isDevMode && details !== undefined ? { details } : {}),
    },
    meta: buildMeta(res.locals.requestId as string | undefined),
  };
  res.status(statusCode).json(body);
}

// ────────────────────────────────────────────────────────────────
// Shorthand Helpers
// ────────────────────────────────────────────────────────────────

/** 400 Bad Request */
export function sendBadRequest(res: Response, message: string, details?: unknown): void {
  sendError(res, 400, ErrorCode.VALIDATION_ERROR, message, details);
}

/** 401 Unauthorized — always use for auth failures (never 403 per Rule 6.3) */
export function sendUnauthorized(res: Response, code: string = ErrorCode.AUTH_TOKEN_INVALID, message = 'Unauthorized'): void {
  sendError(res, 401, code, message);
}

/** 404 Not Found */
export function sendNotFound(res: Response, code: string = ErrorCode.NOT_FOUND, message = 'Resource not found'): void {
  sendError(res, 404, code, message);
}

/** 429 Too Many Requests */
export function sendRateLimitExceeded(res: Response): void {
  sendError(res, 429, ErrorCode.RATE_LIMIT_EXCEEDED, 'Too many requests. Please slow down.');
}

/** 500 Internal Server Error — never expose internals in production */
export function sendInternalError(res: Response, details?: unknown): void {
  sendError(res, 500, ErrorCode.INTERNAL_SERVER_ERROR, 'An unexpected error occurred.', details);
}
