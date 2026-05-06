/**
 * src/types/index.ts
 * Shared TypeScript interfaces used across controllers, services, and middleware.
 */
import { Request } from 'express';
import mongoose from 'mongoose';

// ────────────────────────────────────────────────────────────────
// Authenticated Request
// ────────────────────────────────────────────────────────────────

/** Extends Express Request to include the authenticated user payload from JWT */
export interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    email: string;
  };
}

// ────────────────────────────────────────────────────────────────
// JWT Payload
// ────────────────────────────────────────────────────────────────

export interface JwtAccessPayload {
  userId: string;
  email: string;
  type: 'access';
}

export interface JwtRefreshPayload {
  userId: string;
  tokenId: string; // UUID used as Redis key for revocation
  type: 'refresh';
}

// ────────────────────────────────────────────────────────────────
// Queue Job Types
// ────────────────────────────────────────────────────────────────

/** Job data pushed to Bull routeWriterQueue */
export interface RouteWriterJobData {
  routeId: string;
  /** Array of [lng, lat] coordinate pairs to append */
  coordinates: [number, number][];
}

// ────────────────────────────────────────────────────────────────
// Service Layer Responses
// ────────────────────────────────────────────────────────────────

export interface RouteStartResult {
  sessionId: string;
  routeId: string;
}

export interface RouteUpdateResult {
  accepted: number;
  rejected: number;
}

export interface HeatmapPoint {
  lat: number;
  lng: number;
  intensity: number;
}

export interface HeatmapResult {
  points: HeatmapPoint[];
  generatedAt: string;
  cached: boolean;
}

export interface SuggestionRoutePreview {
  routeId: mongoose.Types.ObjectId;
  startedAt: Date;
  coordinateCount: number;
  tags: string[];
  previewPolyline: string;
}

export interface SuggestionZone {
  type: 'Point';
  coordinates: [number, number];
}

export interface SuggestionResult {
  unexploredZones: SuggestionZone[];
  popularNearbyRoutes: SuggestionRoutePreview[];
}
