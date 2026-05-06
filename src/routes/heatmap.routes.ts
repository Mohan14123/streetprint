/**
 * src/routes/heatmap.routes.ts
 * Heatmap endpoint.
 *
 * Rule 6.3: Requires auth.
 * Rule 6.5: Rate-limited to 30 req/min per user.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { readLimiter } from '../middleware/rateLimiter';
import { getHeatmap } from '../controllers/heatmap.controller';

const router = Router();

/** GET /heatmap?bounds=minLng,minLat,maxLng,maxLat&userId=optional */
router.get('/', requireAuth, readLimiter, getHeatmap);

export default router;
