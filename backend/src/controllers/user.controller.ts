/**
 * src/controllers/user.controller.ts
 * Thin HTTP layer for user account operations.
 *
 * Rule 1.3: asyncHandler wraps all async handlers.
 * Rule 7.3: userId always comes from JWT — never from request body.
 * Rule 11: No DB queries here — all in user.service.ts.
 */
import { Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as userService from '../services/user.service';
import {
  sendSuccess,
  sendError,
  ErrorCode,
} from '../utils/responseHelper';
import type { AuthenticatedRequest } from '../types';

// ────────────────────────────────────────────────────────────────
// GET /user/export — Export all user data (GDPR)
// ────────────────────────────────────────────────────────────────

export const exportData = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const data = await userService.exportUserData(req.user.userId);
      sendSuccess(res, data);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'AUTH_USER_NOT_FOUND') {
        sendError(res, 404, ErrorCode.AUTH_USER_NOT_FOUND, e.message);
      } else {
        throw err;
      }
    }
  },
);

// ────────────────────────────────────────────────────────────────
// DELETE /user — Delete user account (cascading)
// ────────────────────────────────────────────────────────────────

export const deleteAccount = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    try {
      await userService.deleteUserAccount(req.user.userId);
      sendSuccess(res, { deleted: true });
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'AUTH_USER_NOT_FOUND') {
        sendError(res, 404, ErrorCode.AUTH_USER_NOT_FOUND, e.message);
      } else {
        throw err;
      }
    }
  },
);

// ────────────────────────────────────────────────────────────────
// GET /user/stats — User aggregate stats
// ────────────────────────────────────────────────────────────────

export const getStats = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const stats = await userService.getUserStats(req.user.userId);
    sendSuccess(res, { stats });
  },
);
