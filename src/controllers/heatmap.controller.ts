/**
 * src/controllers/heatmap.controller.ts
 * Thin HTTP layer for heatmap queries.
 *
 * Rule 1.3: asyncHandler wraps all async handlers.
 * Rule 6.1: Standard response envelope.
 * Rule 6.4: Zod validates query params.
 * Rule 11: No DB queries here.
 */
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import * as heatmapService from '../services/heatmap.service';
import {
  sendSuccess,
  sendBadRequest,
  ErrorCode,
  sendError,
} from '../utils/responseHelper';
import type { AuthenticatedRequest } from '../types';

// ────────────────────────────────────────────────────────────────
// Zod Schema
// ────────────────────────────────────────────────────────────────

const HeatmapQuerySchema = z.object({
  bounds: z
    .string({ required_error: 'bounds query param is required' })
    .regex(
      /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/,
      'bounds must be in format: minLng,minLat,maxLng,maxLat',
    ),
  userId: z.string().optional(),
});

// ────────────────────────────────────────────────────────────────
// GET /heatmap
// ────────────────────────────────────────────────────────────────

export const getHeatmap = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const parse = HeatmapQuerySchema.safeParse(req.query);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid query parameters', parse.error.flatten());
      return;
    }

    const { bounds, userId } = parse.data;

    try {
      const result = await heatmapService.getHeatmap(bounds, userId);
      sendSuccess(res, result);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.message.includes('bounds') || e.message.includes('Bounds')) {
        sendError(res, 400, ErrorCode.GPS_BOUNDS_INVALID, e.message);
      } else {
        throw err;
      }
    }
  },
);
