/**
 * src/routes/auth.routes.ts
 * Auth endpoint definitions.
 *
 * Rule 6.3: POST /auth/register and POST /auth/login do NOT require auth.
 *           POST /auth/refresh does NOT require auth (token is in body).
 *           POST /auth/logout DOES require auth (to identify the user).
 *           GET  /auth/verify-email does NOT require auth (link from email).
 *           POST /auth/resend-verification DOES require auth.
 *           POST /auth/forgot-password does NOT require auth.
 *           POST /auth/reset-password does NOT require auth (token in body).
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  register,
  login,
  refreshToken,
  logout,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
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

/** GET /auth/verify-email?token=xxx — no auth required (B7) */
router.get('/verify-email', verifyEmail);

/** POST /auth/resend-verification — auth required (B7) */
router.post('/resend-verification', requireAuth, resendVerification);

/** POST /auth/forgot-password — no auth required (B8) */
router.post('/forgot-password', forgotPassword);

/** POST /auth/reset-password — no auth required, token in body (B8) */
router.post('/reset-password', resetPassword);

export default router;

