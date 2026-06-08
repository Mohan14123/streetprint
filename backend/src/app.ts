/**
 * src/app.ts
 * Express application assembly.
 *
 * Rule 1.1: server.listen() is NEVER called here — only in server.ts.
 * Rule 1.2: globalErrorHandler MUST be the LAST middleware registered.
 * Rule 9.2: All logging via Winston; requestLogger bridges Morgan → Winston.
 */
import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env';
import promBundle from 'express-prom-bundle';

import { attachRequestId, requestLogger } from './middleware/requestLogger';
import { globalErrorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import routeRoutes from './routes/route.routes';
import heatmapRoutes from './routes/heatmap.routes';
import suggestionRoutes from './routes/suggestion.routes';
import placeRoutes from './routes/place.routes';
import userRoutes from './routes/user.routes';
import eventsRouter from './routes/events.routes';

const app: Application = express();

// ────────────────────────────────────────────────────────────────
// Security & parsing middleware
// ────────────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS — allow Vite dev origin and the configured production CLIENT_URL
const allowedOrigins = [
  env.CLIENT_URL,              // production origin from env (optional)
  'http://localhost:5173',     // Vite dev server
  'http://127.0.0.1:5173',
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,           // needed for cookies (refresh token)
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ────────────────────────────────────────────────────────────────
// Prometheus Metrics Middleware
// ────────────────────────────────────────────────────────────────
const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  includeStatusCode: true,
  includeUp: true,
  promClient: {
    collectDefaultMetrics: {},
  },
});
app.use(metricsMiddleware as unknown as express.RequestHandler);

// ────────────────────────────────────────────────────────────────
// Request tracing & logging
// ────────────────────────────────────────────────────────────────
app.use(attachRequestId);
app.use(requestLogger);

// ────────────────────────────────────────────────────────────────
// Health check (no auth required)
// ────────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Diagnostic health check accessible through Vite proxy (/api/*)
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ────────────────────────────────────────────────────────────────
// API Routes
// ────────────────────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/route',       routeRoutes);
app.use('/api/heatmap',     heatmapRoutes);
app.use('/api/suggestions', suggestionRoutes);
app.use('/api/places',      placeRoutes);
app.use('/api/user',        userRoutes);
app.use('/api/events',      eventsRouter);

// ────────────────────────────────────────────────────────────────
// 404 handler
// ────────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    data: null,
    error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' },
    meta: { requestId: '-', timestamp: new Date().toISOString() },
  });
});

// ────────────────────────────────────────────────────────────────
// Global error handler — MUST be last (Rule 1.2)
// ────────────────────────────────────────────────────────────────
app.use(globalErrorHandler);

export default app;
