/**
 * src/middleware/auth.ts
 * JWT verification middleware.
 *
 * Rule 6.3: All routes except POST /auth/register and POST /auth/login require JWT.
 *           Expired → 401. Invalid → 401. Missing → 401. Never 403 for auth failures.
 * Rule 9.2: Never log tokens.
 */
import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { sendUnauthorized, ErrorCode } from '../utils/responseHelper';
import type { AuthenticatedRequest, JwtAccessPayload } from '../types';
import type { Request } from 'express';

/**
 * Express middleware that verifies the Authorization: Bearer <token> header.
 * Attaches the decoded payload to req.user on success.
 * Returns 401 on any auth failure — never 403.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendUnauthorized(res, ErrorCode.AUTH_TOKEN_MISSING, 'Authorization header missing or malformed');
    return;
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtAccessPayload;

    if (payload.type !== 'access') {
      sendUnauthorized(res, ErrorCode.AUTH_TOKEN_INVALID, 'Token type mismatch');
      return;
    }

    (req as AuthenticatedRequest).user = {
      userId: payload.userId,
      email: payload.email,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      sendUnauthorized(res, ErrorCode.AUTH_TOKEN_EXPIRED, 'Access token has expired');
    } else {
      sendUnauthorized(res, ErrorCode.AUTH_TOKEN_INVALID, 'Invalid access token');
    }
  }
}
