/**
 * src/controllers/place.controller.ts
 * Thin HTTP layer for saved places CRUD.
 *
 * Rule 1.3: asyncHandler wraps all async handlers.
 * Rule 6.4: Zod validates all input.
 * Rule 7.3: userId always comes from JWT — never from request body.
 * Rule 11: No DB queries here.
 */
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import * as placeService from '../services/place.service';
import {
  sendSuccess,
  sendBadRequest,
  sendError,
  ErrorCode,
} from '../utils/responseHelper';
import type { AuthenticatedRequest } from '../types';

// ────────────────────────────────────────────────────────────────
// Zod Schemas
// ────────────────────────────────────────────────────────────────

const SavePlaceSchema = z.object({
  label: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  notes: z.string().max(1_000).optional(),
});

const GetPlacesQuerySchema = z.object({
  visited: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

const PlaceIdParamSchema = z.object({
  id: z.string().min(1, 'id param is required'),
});

const UpdatePlaceSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  notes: z.string().max(1_000).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

// ────────────────────────────────────────────────────────────────
// POST /places/save
// ────────────────────────────────────────────────────────────────

export const savePlace = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const parse = SavePlaceSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid request body', parse.error.flatten());
      return;
    }

    const { label, lat, lng, notes } = parse.data;

    try {
      const { place, isDuplicate } = await placeService.savePlace(
        req.user.userId,
        label,
        lat,
        lng,
        notes,
      );

      // Return 200 for duplicates, 201 for new
      sendSuccess(res, { place, isDuplicate }, isDuplicate ? 200 : 201);
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

// ────────────────────────────────────────────────────────────────
// GET /places
// ────────────────────────────────────────────────────────────────

export const getPlaces = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const parse = GetPlacesQuerySchema.safeParse(req.query);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid query parameters', parse.error.flatten());
      return;
    }

    const places = await placeService.getPlaces(req.user.userId, parse.data.visited);
    sendSuccess(res, { places });
  },
);

// ────────────────────────────────────────────────────────────────
// PATCH /places/:id/visited
// ────────────────────────────────────────────────────────────────

export const markVisited = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const parse = PlaceIdParamSchema.safeParse(req.params);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid place ID', parse.error.flatten());
      return;
    }

    try {
      const place = await placeService.markPlaceVisited(req.user.userId, parse.data.id);
      sendSuccess(res, { place });
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'PLACE_NOT_FOUND') {
        sendError(res, 404, ErrorCode.PLACE_NOT_FOUND, e.message);
      } else {
        throw err;
      }
    }
  },
);

// ────────────────────────────────────────────────────────────────
// DELETE /places/:id
// ────────────────────────────────────────────────────────────────

export const deletePlace = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const parse = PlaceIdParamSchema.safeParse(req.params);
    if (!parse.success) {
      sendBadRequest(res, 'Invalid place ID', parse.error.flatten());
      return;
    }

    try {
      await placeService.deletePlace(req.user.userId, parse.data.id);
      sendSuccess(res, { deleted: true });
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'PLACE_NOT_FOUND') {
        sendError(res, 404, ErrorCode.PLACE_NOT_FOUND, e.message);
      } else {
        throw err;
      }
    }
  },
);

// ────────────────────────────────────────────────────────────────
// PATCH /places/:id
// ────────────────────────────────────────────────────────────────

export const updatePlace = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const paramParse = PlaceIdParamSchema.safeParse(req.params);
    if (!paramParse.success) {
      sendBadRequest(res, 'Invalid place ID', paramParse.error.flatten());
      return;
    }

    const bodyParse = UpdatePlaceSchema.safeParse(req.body);
    if (!bodyParse.success) {
      sendBadRequest(res, 'Invalid request body', bodyParse.error.flatten());
      return;
    }

    try {
      const place = await placeService.updatePlace(
        req.user.userId,
        paramParse.data.id,
        bodyParse.data,
      );
      sendSuccess(res, { place });
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'PLACE_NOT_FOUND') {
        sendError(res, 404, ErrorCode.PLACE_NOT_FOUND, e.message);
      } else if (e.code === 'GPS_INVALID') {
        sendError(res, 400, ErrorCode.GPS_INVALID, e.message);
      } else if (e.code === 'VALIDATION_ERROR') {
        sendBadRequest(res, e.message);
      } else {
        throw err;
      }
    }
  },
);

// ────────────────────────────────────────────────────────────────
// POST /places/overpass
// Proxy for Overpass API to bypass browser CORS / User-Agent issues
// ────────────────────────────────────────────────────────────────

export const proxyOverpass = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> => {
    const { query } = req.body;
    if (!query || typeof query !== 'string') {
      sendBadRequest(res, 'Query is required');
      return;
    }

    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'RouteMemoryApp/1.0 (mohansanjayrohini@gmail.com)'
        },
        body: `data=${encodeURIComponent(query)}`
      });

      if (!response.ok) {
        throw new Error(`Overpass API responded with status: ${response.status}`);
      }

      const data = await response.json();
      sendSuccess(res, data);
    } catch (err) {
      console.error('[overpass-proxy] Error fetching POIs:', err);
      sendError(res, 502, 'EXTERNAL_API_ERROR', 'Failed to fetch POIs from Overpass');
    }
  }
);

