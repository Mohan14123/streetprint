/**
 * src/routes/events.routes.ts
 * Server-Sent Events (SSE) endpoint.
 *
 * GET /events — authenticated, streams events to connected clients.
 * Token accepted as query param on this endpoint only (EventSource doesn't support headers).
 *
 * Rule 6.3: Auth required (JWT validated as query param here).
 * Rule 1.3: All async handlers wrapped in try/catch.
 * Rule 9.3: Winston logger only.
 */
import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../config/logger';
import { env } from '../config/env';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// SSE Client Registry
// Keyed by userId → Set<Response> (one user may have multiple tabs)
// ─────────────────────────────────────────────────────────────────────────────

/** All currently connected SSE response streams, keyed by userId */
export const sseClients = new Map<string, Set<Response>>();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Push a named event + JSON payload to all streams for a specific user.
 * Rule 9.3: failures are logged, not thrown.
 */
export function pushToUser(
  userId: string,
  event: string,
  data: unknown,
): void {
  const clientSet = sseClients.get(userId);
  if (!clientSet || clientSet.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clientSet) {
    try {
      res.write(payload);
    } catch (err) {
      logger.warn('[events] pushToUser write error', { userId, event, error: err });
    }
  }
}

/**
 * Broadcast a named event + JSON payload to ALL connected clients.
 */
export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, clientSet] of sseClients) {
    for (const res of clientSet) {
      try {
        res.write(payload);
      } catch (err) {
        logger.warn('[events] broadcast write error', { event, error: err });
      }
    }
  }
}

/**
 * Graceful shutdown helper — called from server.ts before closing MongoDB.
 * Sends a 'server:shutdown' event to all clients then drains the map.
 */
export function shutdownSseClients(): void {
  const shutdownPayload = `event: server:shutdown\ndata: ${JSON.stringify({ reason: 'Server shutting down' })}\n\n`;
  for (const [userId, clientSet] of sseClients) {
    for (const res of clientSet) {
      try {
        res.write(shutdownPayload);
        res.end();
      } catch {
        // already closed — ignore
      }
    }
    logger.debug('[events] Closed SSE streams for user during shutdown', { userId });
  }
  sseClients.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT token extractor (query param only for SSE endpoint)
// ─────────────────────────────────────────────────────────────────────────────

interface JwtPayload {
  userId: string;
  iat: number;
  exp: number;
}

function extractUserIdFromToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    return decoded.userId ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /events
// ─────────────────────────────────────────────────────────────────────────────

router.get('/', (req: Request, res: Response) => {
  try {
    // Rule 6.3: Auth required — token as query param for SSE
    const token = req.query['token'];
    if (typeof token !== 'string' || !token) {
      res.status(401).json({
        success: false,
        data: null,
        error: { code: 'AUTH_TOKEN_MISSING', message: 'Token query parameter is required.' },
        meta: { requestId: '-', timestamp: new Date().toISOString() },
      });
      return;
    }

    const userId = extractUserIdFromToken(token);
    if (!userId) {
      res.status(401).json({
        success: false,
        data: null,
        error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Invalid or expired token.' },
        meta: { requestId: '-', timestamp: new Date().toISOString() },
      });
      return;
    }

    // ── SSE headers ───────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // critical for nginx proxy-buffering
    res.flushHeaders();                        // flush headers immediately

    // ── Register client ──────────────────────────────────────────────────────
    if (!sseClients.has(userId)) {
      sseClients.set(userId, new Set());
    }
    const clientSet = sseClients.get(userId)!;
    clientSet.add(res);

    logger.info('[events] SSE client connected', {
      userId,
      totalClients: clientSet.size,
    });

    // ── Heartbeat (prevents proxy/firewall timeout) ───────────────────────────
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25_000);

    // ── Cleanup on disconnect ────────────────────────────────────────────────
    req.on('close', () => {
      clearInterval(heartbeat);
      clientSet.delete(res);
      if (clientSet.size === 0) {
        sseClients.delete(userId);
      }
      logger.info('[events] SSE client disconnected', { userId });
    });
  } catch (err) {
    logger.error('[events] SSE setup error', { error: err });
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
});

export default router;
