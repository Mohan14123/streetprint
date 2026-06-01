/**
 * src/services/auth.service.ts
 * Authentication — register, login, refresh token.
 *
 * Rule 6.3: All auth failures return 401 — never 403.
 * Rule 10.2: JWT secrets from env.ts, never hardcoded. Min 32 chars enforced by Zod.
 * Rule 3.2: Refresh tokens stored in Redis with exact JWT_REFRESH_EXPIRY TTL.
 * Rule 9.2: Never log passwords or tokens.
 * Rule 11: No DB queries in controllers.
 */
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import User, { IUser } from '../models/User';
import { env } from '../config/env';
import logger from '../config/logger';
import { cacheGet, cacheSet, cacheDel } from '../config/redis';
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

// ────────────────────────────────────────────────────────────────
// Register
// ────────────────────────────────────────────────────────────────

/**
 * Register a new user.
 * - Checks for duplicate email.
 * - Hashes password with bcrypt (12 rounds).
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

  const user = await User.create({
    email: email.toLowerCase(),
    passwordHash,
    displayName,
  });

  const userId = user._id.toString();
  const accessToken = signAccessToken(userId, user.email);
  const refreshToken = await signRefreshToken(userId);

  logger.info('[auth.service] User registered', { userId, email: user.email });

  return {
    accessToken,
    refreshToken,
    user: {
      _id: user._id,
      email: user.email,
      displayName: user.displayName,
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
