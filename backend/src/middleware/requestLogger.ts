/**
 * src/middleware/requestLogger.ts
 * HTTP request logging with Morgan, piped through Winston.
 *
 * Rule 9.2: Structured logging — all logs via Winston, never console.log.
 * Rule 9.3: No console.log in application code.
 *
 * Morgan formats are streamed to the Winston logger at 'http' level (debug in dev,
 * silent in test). Uses the 'combined' format in production for full audit trail,
 * and 'dev' format in development for readability.
 */
import morgan from 'morgan';
import { RequestHandler, Response as ExpressResponse } from 'express';
import { ServerResponse } from 'http';
import logger from '../config/logger';
import { env } from '../config/env';

/** Morgan token: request ID from res.locals */
morgan.token('request-id', (_req, res: ServerResponse) => {
  // Morgan types res as ServerResponse; cast to express.Response for .locals access
  const expressRes = res as unknown as ExpressResponse;
  return (expressRes.locals['requestId'] as string | undefined) ?? '-';
});

/** Write stream bridge from Morgan → Winston */
const morganStream = {
  write: (message: string): void => {
    // Strip trailing newline that Morgan appends
    logger.http(message.trimEnd());
  },
};

/** Skip request logging in test environment */
function skip(): boolean {
  return env.NODE_ENV === 'test';
}

const format =
  env.NODE_ENV === 'production'
    ? ':request-id :remote-addr :method :url :status :res[content-length] - :response-time ms'
    : 'dev';

export const requestLogger: RequestHandler = morgan(format, {
  stream: morganStream,
  skip,
}) as RequestHandler;

// ────────────────────────────────────────────────────────────────
// Request ID Middleware
// ────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Attach a unique request ID to each request via res.locals.requestId.
 * Used by the response helpers (buildMeta) and Morgan token above.
 */
export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  res.locals['requestId'] = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}
