/**
 * src/controllers/auth.controller.ts
 * Thin HTTP layer for auth endpoints.
 *
 * Rule 1.3: asyncHandler wraps all async handlers.
 * Rule 6.3: All auth failures respond 401. Never 403 for auth.
 * Rule 6.4: Zod validates all input.
 * Rule 9.2: Never log passwords or tokens.
 * Rule 11: No DB queries here.
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import * as authService from '../services/auth.service';
import {
  sendSuccess,
  sendBadRequest,
  sendUnauthorized,
  sendError,
  ErrorCode,
} from '../utils/responseHelper';
import type { AuthenticatedRequest } from '../types';

// ────────────────────────────────────────────────────────────────
// Zod Schemas
// ────────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1).max(100),
});

const LoginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

const LogoutSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

// ────────────────────────────────────────────────────────────────
// POST /auth/register
// ────────────────────────────────────────────────────────────────

export const register = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const parse = RegisterSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid registration data', parse.error.flatten());
      return;
    }

    const { email, password, displayName } = parse.data;

    try {
      const result = await authService.register(email, password, displayName);
      sendSuccess(res, result, 201);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'AUTH_EMAIL_TAKEN') {
        sendError(res, 409, ErrorCode.AUTH_EMAIL_TAKEN, e.message);
      } else {
        throw err;
      }
    }
  },
);

// ────────────────────────────────────────────────────────────────
// POST /auth/login
// ────────────────────────────────────────────────────────────────

export const login = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const parse = LoginSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid login data', parse.error.flatten());
      return;
    }

    const { email, password } = parse.data;

    try {
      const result = await authService.login(email, password);
      sendSuccess(res, result);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'AUTH_CREDENTIALS_INVALID') {
        // Rule 6.3: Use 401 for all auth failures — never 403
        sendUnauthorized(res, ErrorCode.AUTH_CREDENTIALS_INVALID, 'Invalid email or password');
      } else {
        throw err;
      }
    }
  },
);

// ────────────────────────────────────────────────────────────────
// POST /auth/refresh
// ────────────────────────────────────────────────────────────────

export const refreshToken = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const parse = RefreshSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid request body', parse.error.flatten());
      return;
    }

    try {
      const result = await authService.refreshAccessToken(parse.data.refreshToken);
      sendSuccess(res, result);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (
        e.code === 'AUTH_TOKEN_EXPIRED' ||
        e.code === 'AUTH_TOKEN_INVALID' ||
        e.code === 'AUTH_USER_NOT_FOUND'
      ) {
        sendUnauthorized(res, e.code, e.message);
      } else {
        throw err;
      }
    }
  },
);

// ────────────────────────────────────────────────────────────────
// POST /auth/logout
// ────────────────────────────────────────────────────────────────

export const logout = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const parse = LogoutSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid request body', parse.error.flatten());
      return;
    }

    await authService.revokeRefreshToken(parse.data.refreshToken);
    sendSuccess(res, { message: 'Logged out successfully' });
  },
);
