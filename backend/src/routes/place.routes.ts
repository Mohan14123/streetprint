/**
 * src/routes/place.routes.ts
 * Saved places endpoints.
 *
 * Rule 6.3: All endpoints require auth.
 * Rule 7.3: userId enforced from JWT — never from request body.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  savePlace,
  getPlaces,
  markVisited,
  deletePlace,
  updatePlace,
} from '../controllers/place.controller';

const router = Router();

// All place endpoints require authentication
router.use(requireAuth);

/** POST /places/save — save a new place (deduplicates within 10 m) */
router.post('/save', savePlace);

/** GET /places — get all saved places, optional ?visited=true|false filter */
router.get('/', getPlaces);

/** PATCH /places/:id/visited — mark a place as visited */
router.patch('/:id/visited', markVisited);

/** DELETE /places/:id — delete a saved place */
router.delete('/:id', deletePlace);

/** PATCH /places/:id — update a saved place's label, notes, or coordinates */
router.patch('/:id', updatePlace);

export default router;
