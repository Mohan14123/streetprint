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
