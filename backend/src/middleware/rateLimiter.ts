/**
 * src/middleware/rateLimiter.ts
 * Per-user rate limiting using Redis sliding window.
 *
 * Rule 6.5: /route/update → 60 req/min per user.
 *            /heatmap and /suggestions → 30 req/min per user.
 * Rule 3.1: If Redis is down → skip rate limiting (fail open). Never block requests.
 * Rule 9.3: No console.log — use logger.
 */
import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';
import { cacheAvailable, getRedisClient } from '../config/redis';
import { sendRateLimitExceeded } from '../utils/responseHelper';
import type { AuthenticatedRequest } from '../types';

/**
 * Build a per-user rate limiter middleware.
 *
 * Uses Redis INCR + EXPIRE sliding window (1-minute window).
 * If Redis is unavailable → fail open (allow request).
 *
 * @param maxRequests - Maximum number of requests per minute per user
 * @param windowSecs - Window size in seconds (default: 60)
 */
export function createRateLimiter(maxRequests: number, windowSecs = 60) {
  return async function rateLimiter(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    // Fail open if Redis is unavailable (Rule 3.1)
    if (!cacheAvailable) {
      next();
      return;
    }

    const userId = (req as AuthenticatedRequest).user?.userId;
    if (!userId) {
      // Not yet authenticated — let the auth middleware handle it
      next();
      return;
    }

    const key = `ratelimit:${req.path}:${userId}`;

    try {
      const redis = getRedisClient();
      const current = await redis.incr(key);

      if (current === 1) {
        // First request in window — set expiry
        await redis.expire(key, windowSecs);
      }

      if (current > maxRequests) {
        logger.warn('[rateLimiter] Rate limit exceeded', {
          userId,
          path: req.path,
          current,
          maxRequests,
        });
        sendRateLimitExceeded(res);
        return;
      }

      // Add rate limit headers for observability
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - current));
      res.setHeader('X-RateLimit-Window', windowSecs);

      next();
    } catch (err) {
      // Fail open — Redis error should not block requests (Rule 3.1)
      logger.warn('[rateLimiter] Redis error during rate limit check — skipping', {
        userId,
        path: req.path,
        error: err,
      });
      next();
    }
  };
}

/** 60 req/min — for GPS update endpoint */
export const routeUpdateLimiter = createRateLimiter(60);

/** 30 req/min — for heatmap and suggestion endpoints */
export const readLimiter = createRateLimiter(30);
