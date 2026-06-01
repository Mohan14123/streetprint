/**
 * src/controllers/suggestion.controller.ts
 * Thin HTTP layer for suggestion queries.
 *
 * Rule 1.3: asyncHandler wraps all async handlers.
 * Rule 6.4: Zod validates query params.
 * Rule 11: No DB queries here.
 */
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import * as suggestionService from '../services/suggestion.service';
import {
  sendSuccess,
  sendBadRequest,
  sendError,
  ErrorCode,
} from '../utils/responseHelper';
import type { AuthenticatedRequest } from '../types';

// ────────────────────────────────────────────────────────────────
// Zod Schema
// ────────────────────────────────────────────────────────────────

const SuggestionQuerySchema = z.object({
  lat: z.coerce
    .number({ required_error: 'lat is required' })
    .min(-90)
    .max(90),
  lng: z.coerce
    .number({ required_error: 'lng is required' })
    .min(-180)
    .max(180),
  radiusMeters: z.coerce.number().positive().max(50_000).default(2_000),
});

// ────────────────────────────────────────────────────────────────
// GET /suggestions
// ────────────────────────────────────────────────────────────────

export const getSuggestions = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const parse = SuggestionQuerySchema.safeParse(req.query);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid query parameters', parse.error.flatten());
      return;
    }

    const { lat, lng, radiusMeters } = parse.data;

    try {
      const result = await suggestionService.getSuggestions(
        req.user.userId,
        lat,
        lng,
        radiusMeters,
      );
      sendSuccess(res, result);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'GPS_INVALID') {
        sendError(res, 400, ErrorCode.GPS_INVALID, e.message);
      } else {
        throw err;
      }
    }
  },
);
