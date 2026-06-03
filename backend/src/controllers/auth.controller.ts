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
import logger from '../config/logger';
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

const ForgotPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
});

const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const VerifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
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
      const e = err as Error & { code?: string | number };

      // Application-level duplicate email check
      if (e.code === 'AUTH_EMAIL_TAKEN') {
        sendError(res, 409, ErrorCode.AUTH_EMAIL_TAKEN, e.message);
        return;
      }

      // MongoDB duplicate key error (race condition fallback)
      if (e.code === 11000 || (e as { code?: number }).code === 11000) {
        sendError(res, 409, ErrorCode.AUTH_EMAIL_TAKEN, 'Email is already registered.');
        return;
      }

      // Log full error for debugging — Rule 9.2 (no passwords/tokens logged)
      logger.error('[auth.controller] Register failed with unexpected error', {
        email,
        errorName: e.name,
        errorMessage: e.message,
        errorCode: e.code,
        stack: e.stack,
      });

      throw err;
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
        return;
      }

      // Log full error for debugging
      logger.error('[auth.controller] Login failed with unexpected error', {
        email,
        errorName: e.name,
        errorMessage: e.message,
        errorCode: e.code,
        stack: e.stack,
      });

      throw err;
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

// ────────────────────────────────────────────────────────────────
// GET /auth/verify-email (B7)
// ────────────────────────────────────────────────────────────────

export const verifyEmail = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const parse = VerifyEmailSchema.safeParse(req.query);
    if (!parse.success) {
      sendBadRequest(res, 'Verification token is required', parse.error.flatten());
      return;
    }

    try {
      const result = await authService.verifyEmail(parse.data.token);
      sendSuccess(res, result);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'AUTH_TOKEN_INVALID') {
        sendError(res, 400, ErrorCode.AUTH_TOKEN_INVALID, e.message);
      } else {
        throw err;
      }
    }
  },
);

// ────────────────────────────────────────────────────────────────
// POST /auth/resend-verification (B7)
// ────────────────────────────────────────────────────────────────

export const resendVerification = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const result = await authService.resendVerification(req.user.userId);
      sendSuccess(res, result);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'AUTH_USER_NOT_FOUND') {
        sendUnauthorized(res, e.code, e.message);
      } else {
        throw err;
      }
    }
  },
);

// ────────────────────────────────────────────────────────────────
// POST /auth/forgot-password (B8)
// ────────────────────────────────────────────────────────────────

export const forgotPassword = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const parse = ForgotPasswordSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid request body', parse.error.flatten());
      return;
    }

    const result = await authService.forgotPassword(parse.data.email);
    sendSuccess(res, result);
  },
);

// ────────────────────────────────────────────────────────────────
// POST /auth/reset-password (B8)
// ────────────────────────────────────────────────────────────────

export const resetPassword = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const parse = ResetPasswordSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid request body', parse.error.flatten());
      return;
    }

    try {
      const result = await authService.resetPassword(parse.data.token, parse.data.password);
      sendSuccess(res, result);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'AUTH_TOKEN_INVALID') {
        sendError(res, 400, ErrorCode.AUTH_TOKEN_INVALID, e.message);
      } else {
        throw err;
      }
    }
  },
);
