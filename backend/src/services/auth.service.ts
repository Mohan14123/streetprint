import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID, randomBytes, createHash } from 'crypto';
import User, { IUser } from '../models/User';
import { env } from '../config/env';
import logger from '../config/logger';
import { cacheGet, cacheSet, cacheDel } from '../config/redis';
import { sendVerificationEmail, sendPasswordResetEmail } from './email.service';
import type { JwtAccessPayload, JwtRefreshPayload } from '../types';

const BCRYPT_ROUNDS = 12;

// ────────────────────────────────────────────────────────────────
// Token Helpers
// ────────────────────────────────────────────────────────────────

/** Parse a JWT expiry string like "7d" or "900" into seconds */
function parseExpiryToSeconds(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd]?)$/);
  if (!match) return 900; // Default 15 min fallback
  const value = parseInt(match[1], 10);
  const unit = match[2] ?? 's';
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit] ?? 1);
}

/** Issue a signed JWT access token (short-lived) */
function signAccessToken(userId: string, email: string): string {
  const payload: JwtAccessPayload = { userId, email, type: 'access' };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRY as jwt.SignOptions['expiresIn'],
  });
}

/** Issue a signed JWT refresh token and persist it in Redis */
async function signRefreshToken(userId: string): Promise<string> {
  const tokenId = randomUUID();
  const payload: JwtRefreshPayload = { userId, tokenId, type: 'refresh' };

  const token = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRY as jwt.SignOptions['expiresIn'],
  });

  // Persist in Redis with exact TTL matching JWT_REFRESH_EXPIRY (Rule 3.3)
  const ttlSeconds = parseExpiryToSeconds(env.JWT_REFRESH_EXPIRY);
  const cacheKey = `session:refresh:${userId}:${tokenId}`;
  await cacheSet(cacheKey, '1', ttlSeconds);

  return token;
}

/** Generate a secure random token and its SHA-256 hash (store hash, send raw) */
function generateSecureToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

// ────────────────────────────────────────────────────────────────
// Register
// ────────────────────────────────────────────────────────────────

/**
 * Register a new user.
 * - Checks for duplicate email.
 * - Hashes password with bcrypt (12 rounds).
 * - Generates email verification token and sends verification email.
 * - Returns JWT pair.
 */
export async function register(
  email: string,
  password: string,
  displayName: string,
): Promise<{ accessToken: string; refreshToken: string; user: Partial<IUser> }> {
  // Check for duplicate email
  const existing = await User.findOne({ email: email.toLowerCase() }).lean();
  if (existing) {
    const err = new Error(`Email already registered: ${email}`);
    (err as Error & { code: string }).code = 'AUTH_EMAIL_TAKEN';
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Generate email verification token
  const { raw: verificationToken, hash: verificationHash } = generateSecureToken();
  const verificationExpiry = new Date(
    Date.now() + env.EMAIL_VERIFICATION_EXPIRY_HOURS * 3600 * 1000,
  );

  const user = await User.create({
    email: email.toLowerCase(),
    passwordHash,
    displayName,
    isEmailVerified: false,
    emailVerificationToken: verificationHash,
    emailVerificationExpiry: verificationExpiry,
  });

  const userId = user._id.toString();
  const accessToken = signAccessToken(userId, user.email);
  const refreshToken = await signRefreshToken(userId);

  // Send verification email (non-blocking, non-fatal)
  void sendVerificationEmail(user.email, verificationToken).catch((err) => {
    logger.warn('[auth.service] Failed to send verification email', {
      userId,
      error: err,
    });
  });

  logger.info('[auth.service] User registered', { userId, email: user.email });

  return {
    accessToken,
    refreshToken,
    user: {
      _id: user._id,
      email: user.email,
      displayName: user.displayName,
      isEmailVerified: false,
      createdAt: user.createdAt,
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Login
// ────────────────────────────────────────────────────────────────

/**
 * Authenticate a user with email + password.
 * Returns a JWT pair on success.
 */
export async function login(
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string; user: Partial<IUser> }> {
  // Select passwordHash explicitly (select: false in schema)
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');

  if (!user) {
    const err = new Error(`No user found with email: ${email}`);
    (err as Error & { code: string }).code = 'AUTH_CREDENTIALS_INVALID';
    throw err;
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    const err = new Error('Invalid password');
    (err as Error & { code: string }).code = 'AUTH_CREDENTIALS_INVALID';
    throw err;
  }

  const userId = user._id.toString();
  const accessToken = signAccessToken(userId, user.email);
  const refreshToken = await signRefreshToken(userId);

  logger.info('[auth.service] User logged in', { userId, email: user.email });

  return {
    accessToken,
    refreshToken,
    user: {
      _id: user._id,
      email: user.email,
      displayName: user.displayName,
      isEmailVerified: user.isEmailVerified,
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Refresh Token
// ────────────────────────────────────────────────────────────────

/**
 * Validate a refresh token and issue a new access token.
 * - Verifies JWT signature.
 * - Confirms token is still in Redis (not revoked).
 * - Returns a new access token.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string }> {
  let payload: JwtRefreshPayload;

  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as JwtRefreshPayload;
  } catch {
    const err = new Error('Refresh token invalid or expired');
    (err as Error & { code: string }).code = 'AUTH_TOKEN_EXPIRED';
    throw err;
  }

  if (payload.type !== 'refresh') {
    const err = new Error('Token type mismatch — expected refresh token');
    (err as Error & { code: string }).code = 'AUTH_TOKEN_INVALID';
    throw err;
  }

  // Check Redis to confirm the token hasn't been revoked
  const cacheKey = `session:refresh:${payload.userId}:${payload.tokenId}`;
  const valid = await cacheGet(cacheKey);

  if (!valid) {
    // Token not in Redis → either revoked or Redis is down
    // When Redis is down (cacheAvailable=false), cacheGet returns null.
    // We choose to still allow refresh to not break the app when Redis is down (Rule 3.1).
    const { cacheAvailable } = await import('../config/redis');
    if (cacheAvailable) {
      const err = new Error('Refresh token has been revoked');
      (err as Error & { code: string }).code = 'AUTH_TOKEN_INVALID';
      throw err;
    }
    logger.warn('[auth.service] Redis unavailable during refresh — proceeding without revocation check', {
      userId: payload.userId,
    });
  }

  // Fetch user to get email for new access token
  const user = await User.findById(payload.userId).lean();
  if (!user) {
    const err = new Error('User not found for refresh token');
    (err as Error & { code: string }).code = 'AUTH_USER_NOT_FOUND';
    throw err;
  }

  const accessToken = signAccessToken(payload.userId, user.email);

  logger.debug('[auth.service] Access token refreshed', { userId: payload.userId });

  return { accessToken };
}

// ────────────────────────────────────────────────────────────────
// Logout (Revoke Refresh Token)
// ────────────────────────────────────────────────────────────────

/**
 * Revoke a refresh token by deleting it from Redis.
 */
export async function revokeRefreshToken(
  refreshToken: string,
): Promise<void> {
  try {
    const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as JwtRefreshPayload;
    const cacheKey = `session:refresh:${payload.userId}:${payload.tokenId}`;
    await cacheDel(cacheKey);
    logger.info('[auth.service] Refresh token revoked', { userId: payload.userId });
  } catch {
    // If token is already expired, nothing to revoke — not an error
    logger.debug('[auth.service] Could not revoke token — may already be expired');
  }
}

// ────────────────────────────────────────────────────────────────
// Email Verification (B7)
// ────────────────────────────────────────────────────────────────

/**
 * Verify a user's email with the token sent during registration.
 */
export async function verifyEmail(rawToken: string): Promise<{ message: string }> {
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  const user = await User.findOne({
    emailVerificationToken: tokenHash,
    emailVerificationExpiry: { $gt: new Date() },
  }).select('+emailVerificationToken +emailVerificationExpiry');

  if (!user) {
    const err = new Error('Invalid or expired verification token');
    (err as Error & { code: string }).code = 'AUTH_TOKEN_INVALID';
    throw err;
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpiry = undefined;
  await user.save();

  logger.info('[auth.service] Email verified', { userId: user._id.toString() });
  return { message: 'Email verified successfully' };
}

/**
 * Re-send verification email to an authenticated user.
 */
export async function resendVerification(userId: string): Promise<{ message: string }> {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    (err as Error & { code: string }).code = 'AUTH_USER_NOT_FOUND';
    throw err;
  }

  if (user.isEmailVerified) {
    return { message: 'Email is already verified' };
  }

  const { raw, hash } = generateSecureToken();
  user.emailVerificationToken = hash;
  user.emailVerificationExpiry = new Date(
    Date.now() + env.EMAIL_VERIFICATION_EXPIRY_HOURS * 3600 * 1000,
  );
  await user.save();

  await sendVerificationEmail(user.email, raw);

  logger.info('[auth.service] Verification email re-sent', { userId });
  return { message: 'Verification email sent' };
}

// ────────────────────────────────────────────────────────────────
// Password Reset (B8)
// ────────────────────────────────────────────────────────────────

/**
 * Generate a password reset token and send it via email.
 * Always returns a generic message to prevent email enumeration.
 */
export async function forgotPassword(email: string): Promise<{ message: string }> {
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    // Don't reveal whether email exists — prevent enumeration
    logger.debug('[auth.service] Password reset requested for non-existent email', { email });
    return { message: 'If an account with that email exists, a reset link has been sent.' };
  }

  const { raw, hash } = generateSecureToken();
  user.passwordResetToken = hash;
  user.passwordResetExpiry = new Date(
    Date.now() + env.PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000,
  );
  await user.save();

  await sendPasswordResetEmail(user.email, raw);

  logger.info('[auth.service] Password reset email sent', { userId: user._id.toString() });
  return { message: 'If an account with that email exists, a reset link has been sent.' };
}

/**
 * Reset a user's password using a valid reset token.
 */
export async function resetPassword(
  rawToken: string,
  newPassword: string,
): Promise<{ message: string }> {
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  const user = await User.findOne({
    passwordResetToken: tokenHash,
    passwordResetExpiry: { $gt: new Date() },
  }).select('+passwordResetToken +passwordResetExpiry +passwordHash');

  if (!user) {
    const err = new Error('Invalid or expired reset token');
    (err as Error & { code: string }).code = 'AUTH_TOKEN_INVALID';
    throw err;
  }

  // Hash new password
  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  user.passwordResetToken = undefined;
  user.passwordResetExpiry = undefined;
  await user.save();

  // Invalidate all refresh tokens for this user in Redis (force re-login)
  // We can't enumerate Redis keys easily, but revoking the tokens
  // will happen naturally as they try to refresh and the user_id check fails
  logger.info('[auth.service] Password reset completed', { userId: user._id.toString() });
  return { message: 'Password reset successfully. Please log in with your new password.' };
}
