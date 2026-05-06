/**
 * src/controllers/route.controller.ts
 * Thin HTTP layer for Route API — validate, call service, format response.
 *
 * Rule 1.3: All async handlers wrapped in asyncHandler → next(err) on throw.
 * Rule 6.1: All responses use sendSuccess / sendError envelope.
 * Rule 6.4: Zod validates all input before the service layer.
 * Rule 11: No DB queries here — all logic in route.service.ts.
 * Rule 4.1: No direct MongoDB writes — the service delegates to Bull queue.
 */
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import * as routeService from '../services/route.service';
import {
  sendSuccess,
  sendError,
  sendBadRequest,
  ErrorCode,
} from '../utils/responseHelper';
import type { AuthenticatedRequest } from '../types';

// ────────────────────────────────────────────────────────────────
// Zod Schemas
// ────────────────────────────────────────────────────────────────

const StartRouteSchema = z.object({});

const UpdateRouteSchema = z.object({
  sessionId: z.string().uuid('sessionId must be a valid UUID'),
  coordinates: z
    .array(
      z
        .tuple([z.number(), z.number()])
        .or(z.tuple([z.number(), z.number(), z.number()]))
    )
    .min(1, 'At least one coordinate is required'),
});

const EndRouteSchema = z.object({
  sessionId: z.string().uuid('sessionId must be a valid UUID'),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
});

// ────────────────────────────────────────────────────────────────
// POST /route/start
// ────────────────────────────────────────────────────────────────

export const startRoute = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const parse = StartRouteSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid request body', parse.error.flatten());
      return;
    }

    const result = await routeService.startRoute(req.user.userId);
    sendSuccess(res, result, 201);
  },
);

// ────────────────────────────────────────────────────────────────
// POST /route/update
// ────────────────────────────────────────────────────────────────

export const updateRoute = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const parse = UpdateRouteSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid request body', parse.error.flatten());
      return;
    }

    const { sessionId, coordinates } = parse.data;

    try {
      const result = await routeService.updateRoute(
        req.user.userId,
        sessionId,
        coordinates as [number, number, number?][],
      );
      sendSuccess(res, result);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'ROUTE_SESSION_NOT_FOUND') {
        sendError(res, 404, ErrorCode.ROUTE_SESSION_NOT_FOUND, e.message);
      } else if (e.code === 'ROUTE_SESSION_NOT_OWNED') {
        sendError(res, 403, ErrorCode.ROUTE_SESSION_NOT_OWNED, e.message);
      } else {
        throw err; // Re-throw for global error handler
      }
    }
  },
);

// ────────────────────────────────────────────────────────────────
// POST /route/end
// ────────────────────────────────────────────────────────────────

export const endRoute = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const parse = EndRouteSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid request body', parse.error.flatten());
      return;
    }

    const { sessionId, tags } = parse.data;

    try {
      const route = await routeService.endRoute(req.user.userId, sessionId, tags);
      sendSuccess(res, {
        routeId: route._id.toString(),
        status: route.status,
        coordinateCount: route.coordinateCount,
        tags: route.tags,
        startedAt: route.startedAt,
        endedAt: route.endedAt,
      });
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'ROUTE_SESSION_NOT_FOUND') {
        sendError(res, 404, ErrorCode.ROUTE_SESSION_NOT_FOUND, e.message);
      } else if (e.code === 'ROUTE_SESSION_NOT_OWNED') {
        sendError(res, 403, ErrorCode.ROUTE_SESSION_NOT_OWNED, e.message);
      } else if (e.code === 'ROUTE_NOT_FOUND') {
        sendError(res, 404, ErrorCode.ROUTE_NOT_FOUND, e.message);
      } else {
        throw err;
      }
    }
  },
);

// ────────────────────────────────────────────────────────────────
// GET /route (User's routes list)
// ────────────────────────────────────────────────────────────────

export const getUserRoutes = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const routes = await routeService.getUserRoutes(req.user.userId);
    sendSuccess(res, { routes });
  },
);
