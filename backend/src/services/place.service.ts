/**
 * src/services/place.service.ts
 * Bookmark CRUD — saved places with geospatial deduplication.
 *
 * Rule 5.1: Coordinates stored as [lng, lat] — GeoJSON standard.
 * Rule 7.3: user_id enforced from JWT — never from request body.
 * Rule 2.3: $near + $maxDistance on deduplication check (10 m radius).
 * Rule 11: No DB queries in controllers.
 */
import Place, { IPlace } from '../models/Place';
import logger from '../config/logger';
import { isValidWGS84, type LngLat } from '../utils/geoUtils';
import { pushToUser } from '../routes/events.routes';
import { emitEvent, STREAMS } from '../events/producer';

// Deduplication radius in meters (PROMPT §7: "within 10m of this location")
const DEDUP_RADIUS_METERS = 10;

// ────────────────────────────────────────────────────────────────
// Save Place
// ────────────────────────────────────────────────────────────────

/**
 * Save a place for the authenticated user, with deduplication.
 *
 * If the user already has a place within DEDUP_RADIUS_METERS → return existing.
 * Otherwise create a new Place document.
 *
 * @param userId - Authenticated user's MongoDB ObjectId string
 * @param label - Human-readable name for the place
 * @param lat - Latitude (WGS84)
 * @param lng - Longitude (WGS84)
 * @param notes - Optional notes
 * @returns { place, isDuplicate }
 */
export async function savePlace(
  userId: string,
  label: string,
  lat: number,
  lng: number,
  notes?: string,
): Promise<{ place: IPlace; isDuplicate: boolean }> {
  const coord: LngLat = [lng, lat];

  if (!isValidWGS84(coord)) {
    const err = new Error(`Invalid WGS84 coordinates: lng=${lng}, lat=${lat}`);
    (err as Error & { code: string }).code = 'GPS_INVALID';
    throw err;
  }

  // Deduplication check: user already has a place within 10 m? (Rule 2.3: $maxDistance)
  const existing = await Place.findOne({
    user_id: userId,
    location: {
      $nearSphere: {
        $geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        $maxDistance: DEDUP_RADIUS_METERS,
      },
    },
  });

  if (existing) {
    logger.debug('[place.service] Deduplicated place save', {
      userId,
      existingPlaceId: existing._id.toString(),
      label,
    });
    return { place: existing, isDuplicate: true };
  }

  const place = await Place.create({
    user_id: userId,
    label,
    notes,
    location: {
      type: 'Point',
      coordinates: [lng, lat],
    },
    visited: false,
  });

  logger.info('[place.service] Place saved', {
    userId,
    placeId: place._id.toString(),
    label,
    coordinates: [lng, lat],
  });

  // Push SSE event to the user's connected browser clients
  pushToUser(userId, 'place:saved', { placeId: place._id.toString(), label });

  // Emit to Redis Streams for async consumers (non-fatal)
  await emitEvent(STREAMS.PLACE_EVENTS, {
    type:      'place.saved',
    placeId:   place._id.toString(),
    userId,
    label,
    timestamp: new Date().toISOString(),
  });

  return { place, isDuplicate: false };
}

// ────────────────────────────────────────────────────────────────
// Get Places
// ────────────────────────────────────────────────────────────────

/**
 * Retrieve all saved places for the authenticated user.
 * Rule 7.3: Always scoped to userId from JWT.
 * Rule 2.3: .limit() applied.
 *
 * @param userId - Authenticated user's MongoDB ObjectId string
 * @param visited - Optional filter: true = visited only, false = unvisited only
 */
export async function getPlaces(
  userId: string,
  visited?: boolean,
): Promise<IPlace[]> {
  const filter: Record<string, unknown> = { user_id: userId };

  if (visited !== undefined) {
    filter['visited'] = visited;
  }

  const places = await Place.find(filter)
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  return places as unknown as IPlace[];
}

// ────────────────────────────────────────────────────────────────
// Mark Visited
// ────────────────────────────────────────────────────────────────

/**
 * Mark a saved place as visited.
 * Rule 7.3: Enforces that the place belongs to the authenticated user.
 *
 * @param userId - Authenticated user's MongoDB ObjectId string
 * @param placeId - MongoDB ObjectId string of the Place document
 * @returns Updated Place document
 */
export async function markPlaceVisited(
  userId: string,
  placeId: string,
): Promise<IPlace> {
  const place = await Place.findOneAndUpdate(
    { _id: placeId, user_id: userId },
    { $set: { visited: true } },
    { new: true },
  );

  if (!place) {
    const err = new Error(`Place not found or does not belong to user: ${placeId}`);
    (err as Error & { code: string }).code = 'PLACE_NOT_FOUND';
    throw err;
  }

  logger.info('[place.service] Place marked visited', {
    userId,
    placeId,
    label: place.label,
  });

  return place;
}

// ────────────────────────────────────────────────────────────────
// Delete Place
// ────────────────────────────────────────────────────────────────

/**
 * Delete a saved place.
 * Rule 7.3: Enforces that the place belongs to the authenticated user.
 *
 * @param userId - Authenticated user's MongoDB ObjectId string
 * @param placeId - MongoDB ObjectId string of the Place document
 */
export async function deletePlace(
  userId: string,
  placeId: string,
): Promise<void> {
  const result = await Place.findOneAndDelete({
    _id: placeId,
    user_id: userId,
  });

  if (!result) {
    const err = new Error(`Place not found or does not belong to user: ${placeId}`);
    (err as Error & { code: string }).code = 'PLACE_NOT_FOUND';
    throw err;
  }

  logger.info('[place.service] Place deleted', {
    userId,
    placeId,
    label: result.label,
  });

  // Push SSE event to the user's connected browser clients
  pushToUser(userId, 'place:deleted', { placeId });
}

// ────────────────────────────────────────────────────────────────
// Update Place
// ────────────────────────────────────────────────────────────────

/**
 * Update a saved place's label, notes, and/or coordinates.
 * Rule 7.3: Enforces that the place belongs to the authenticated user.
 * Rule 5.1: Coordinates stored as [lng, lat] — GeoJSON standard.
 *
 * @param userId - Authenticated user's MongoDB ObjectId string
 * @param placeId - MongoDB ObjectId string of the Place document
 * @param updates - Fields to update
 */
export async function updatePlace(
  userId: string,
  placeId: string,
  updates: { label?: string; notes?: string; lat?: number; lng?: number },
): Promise<IPlace> {
  const setFields: Record<string, unknown> = {};

  if (updates.label !== undefined) {
    setFields['label'] = updates.label;
  }
  if (updates.notes !== undefined) {
    setFields['notes'] = updates.notes;
  }
  if (updates.lat !== undefined && updates.lng !== undefined) {
    const coord: LngLat = [updates.lng, updates.lat];
    if (!isValidWGS84(coord)) {
      const err = new Error(`Invalid WGS84 coordinates: lng=${updates.lng}, lat=${updates.lat}`);
      (err as Error & { code: string }).code = 'GPS_INVALID';
      throw err;
    }
    setFields['location'] = {
      type: 'Point',
      coordinates: [updates.lng, updates.lat],
    };
  }

  if (Object.keys(setFields).length === 0) {
    const err = new Error('No valid fields to update');
    (err as Error & { code: string }).code = 'VALIDATION_ERROR';
    throw err;
  }

  const place = await Place.findOneAndUpdate(
    { _id: placeId, user_id: userId },
    { $set: setFields },
    { new: true },
  );

  if (!place) {
    const err = new Error(`Place not found or does not belong to user: ${placeId}`);
    (err as Error & { code: string }).code = 'PLACE_NOT_FOUND';
    throw err;
  }

  logger.info('[place.service] Place updated', {
    userId,
    placeId,
    updatedFields: Object.keys(setFields),
  });

  return place;
}
