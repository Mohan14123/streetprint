/**
 * src/models/Route.ts
 * Route schema — GeoJSON LineString with all required 2dsphere and compound indexes.
 * Rule 2.2: 2dsphere index declared in schema using index: '2dsphere'.
 * Rule 5.1: Coordinates stored as [lng, lat] — GeoJSON standard.
 * Rule 5.3: Never simplify routes. Store exact coordinate sequences.
 * Rule 5.5: isPolylineEncoded flag for routes > 500 points.
 */
import mongoose, { Document, Schema, Model } from 'mongoose';

/** GeoJSON LineString type for TypeScript */
export interface GeoJSONLineString {
  type: 'LineString';
  /** All coordinate pairs are [longitude, latitude] — GeoJSON standard */
  coordinates: [number, number][];
}

export type RouteStatus = 'active' | 'completed' | 'abandoned';

export interface IRoute extends Document {
  user_id: mongoose.Types.ObjectId;
  sessionId: string;
  geometry: GeoJSONLineString;
  tags: string[];
  isPublic: boolean;
  startedAt: Date;
  endedAt?: Date;
  status: RouteStatus;
  /** Denormalized coordinate count for fast queries without unwinding the geometry array */
  coordinateCount: number;
  /**
   * True when geometry.coordinates is Google Polyline encoded (routes > 500 points).
   * Rule 5.5: Decode transparently on read so consumers always receive GeoJSON.
   */
  isPolylineEncoded: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RouteSchema = new Schema<IRoute>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    sessionId: {
      type: String,
      required: true,
      unique: true, // Rule PROMPT §12.7: No duplicate routes — sessionId is unique
      index: true,
    },
    geometry: {
      type: {
        type: String,
        enum: ['LineString'],
        required: true,
        default: 'LineString',
      },
      coordinates: {
        type: [[Number]],
        required: true,
        default: [],
      },
    },
    tags: {
      type: [String],
      default: [],
    },
    isPublic: {
      type: Boolean,
      default: true,
      index: true, // Rule 2.2 + Privacy: filter on isPublic frequently
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'abandoned'],
      default: 'active',
    },
    coordinateCount: {
      type: Number,
      default: 0,
    },
    isPolylineEncoded: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

/**
 * 2dsphere index on geometry — MANDATORY for all geospatial queries.
 * Rule 2.2: Never run geospatial queries on unindexed fields.
 */
RouteSchema.index({ geometry: '2dsphere' });

/**
 * Compound index for user route lookups by status.
 * Used by: route.service.ts (findActiveSession, getUserRoutes)
 */
RouteSchema.index({ user_id: 1, status: 1 });

/**
 * Index for community/public route queries.
 * Used by: heatmap.service.ts, suggestion.service.ts
 */
RouteSchema.index({ isPublic: 1 });

const Route: Model<IRoute> = mongoose.model<IRoute>('Route', RouteSchema);

export default Route;
