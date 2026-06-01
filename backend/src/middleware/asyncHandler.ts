/**
 * src/middleware/asyncHandler.ts
 * Wraps async Express route handlers to forward errors to next(err).
 *
 * Rule 1.3: Every async Express handler must be wrapped in try/catch → next(err).
 *           Use this universally — never leave unhandled promise rejections in handlers.
 */
import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler<T extends Request = Request> = (
  req: T,
  res: Response,
  next: NextFunction,
) => Promise<void>;

/**
 * Wraps an async Express route handler so any thrown error is forwarded to next(err).
 * Compatible with authenticated and unauthenticated request types.
 */
export function asyncHandler<T extends Request = Request>(
  fn: AsyncRequestHandler<T>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req as T, res, next).catch(next);
  };
}
