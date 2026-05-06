/**
 * src/models/Place.ts
 * Saved places schema — GeoJSON Point with 2dsphere index.
 * Rule 2.2: 2dsphere index declared in schema.
 * Rule 5.1: Coordinates stored as [lng, lat] — GeoJSON standard.
 * Rule 7.3: user_id enforced in all queries — never expose another user's places.
 */
import mongoose, { Document, Schema, Model } from 'mongoose';

/** GeoJSON Point type for TypeScript */
export interface GeoJSONPoint {
  type: 'Point';
  /** [longitude, latitude] — GeoJSON standard, never [lat, lng] */
  coordinates: [number, number];
}

export interface IPlace extends Document {
  user_id: mongoose.Types.ObjectId;
  label: string;
  notes?: string;
  location: GeoJSONPoint;
  visited: boolean;
  createdAt: Date;
}

const PlaceSchema = new Schema<IPlace>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator(coords: number[]) {
            // Rule 5.1: Validate WGS84 bounds [lng, lat]
            return (
              coords.length === 2 &&
              coords[0] >= -180 &&
              coords[0] <= 180 &&
              coords[1] >= -90 &&
              coords[1] <= 90
            );
          },
          message: 'location.coordinates must be [lng, lat] with valid WGS84 bounds',
        },
      },
    },
    visited: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

/**
 * 2dsphere index on location — MANDATORY for $near deduplication and proximity queries.
 * Rule 2.2: Never run geospatial queries on unindexed fields.
 */
PlaceSchema.index({ location: '2dsphere' });

/**
 * Compound index for fast per-user place retrieval.
 * Rule 7.3: All user-specific queries must be scoped by user_id.
 */
PlaceSchema.index({ user_id: 1 });

const Place: Model<IPlace> = mongoose.model<IPlace>('Place', PlaceSchema);

export default Place;
