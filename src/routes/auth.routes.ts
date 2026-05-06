/**
 * src/routes/auth.routes.ts
 * Auth endpoint definitions.
 *
 * Rule 6.3: POST /auth/register and POST /auth/login do NOT require auth.
 *           POST /auth/refresh does NOT require auth (token is in body).
 *           POST /auth/logout DOES require auth (to identify the user).
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  register,
  login,
  refreshToken,
  logout,
} from '../controllers/auth.controller';

const router = Router();

/** POST /auth/register — no auth required */
router.post('/register', register);

/** POST /auth/login — no auth required */
router.post('/login', login);

/** POST /auth/refresh — no auth required (refresh token in body) */
router.post('/refresh', refreshToken);

/** POST /auth/logout — auth required to identify user */
router.post('/logout', requireAuth, logout);

export default router;
