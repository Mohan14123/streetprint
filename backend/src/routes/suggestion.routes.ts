/**
 * src/routes/suggestion.routes.ts
 * Suggestion endpoint.
 *
 * Rule 6.3: Requires auth.
 * Rule 6.5: Rate-limited to 30 req/min per user.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { readLimiter } from '../middleware/rateLimiter';
import { getSuggestions } from '../controllers/suggestion.controller';

const router = Router();

/** GET /suggestions?lat=&lng=&radiusMeters=2000 */
router.get('/', requireAuth, readLimiter, getSuggestions);

export default router;
