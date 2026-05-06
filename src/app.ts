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

import { attachRequestId, requestLogger } from './middleware/requestLogger';
import { globalErrorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import routeRoutes from './routes/route.routes';
import heatmapRoutes from './routes/heatmap.routes';
import suggestionRoutes from './routes/suggestion.routes';
import placeRoutes from './routes/place.routes';

const app: Application = express();

// ────────────────────────────────────────────────────────────────
// Security & parsing middleware
// ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

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

// ────────────────────────────────────────────────────────────────
// API Routes
// ────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/route', routeRoutes);
app.use('/heatmap', heatmapRoutes);
app.use('/suggestions', suggestionRoutes);
app.use('/places', placeRoutes);

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
