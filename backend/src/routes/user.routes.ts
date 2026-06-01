/**
 * src/routes/user.routes.ts
 * User account routes — data export, account deletion, stats.
 *
 * Rule 6.3: All routes require valid JWT (requireAuth middleware).
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as userController from '../controllers/user.controller';

const router = Router();

// All user routes require authentication
router.use(requireAuth);

// GET /api/user/export — Export all user data (GDPR)
router.get('/export', userController.exportData);

// GET /api/user/stats — User aggregate stats
router.get('/stats', userController.getStats);

// DELETE /api/user — Delete user account (cascading)
router.delete('/', userController.deleteAccount);

export default router;
