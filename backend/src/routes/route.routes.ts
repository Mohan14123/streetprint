/**
 * src/routes/route.routes.ts
 * Route session endpoints.
 *
 * Rule 6.3: All endpoints require auth.
 * Rule 6.5: /route/update rate-limited to 60 req/min per user.
 * Rule 4.1: GPS writes go through Bull queue via the controller → service chain.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { routeUpdateLimiter } from '../middleware/rateLimiter';
import {
  startRoute,
  updateRoute,
  endRoute,
  getUserRoutes,
} from '../controllers/route.controller';

const router = Router();

// All route endpoints require authentication
router.use(requireAuth);

/** POST /route/start — begin a new route session */
router.post('/start', startRoute);

/** POST /route/update — push GPS coordinate batch (rate limited, queued) */
router.post('/update', routeUpdateLimiter, updateRoute);

/** POST /route/end — finalize and complete/abandon a session */
router.post('/end', endRoute);

/** GET /route — get user's route history */
router.get('/', getUserRoutes);

export default router;
