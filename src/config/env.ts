/**
 * src/config/env.ts
 * Zod-validated environment variables.
 * Rule 10.1: All env vars validated at startup before any connections.
 * Rule 10.3: No hardcoded values — everything comes from here.
 * Never use process.env.* directly in service/controller code.
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // MongoDB
  MONGODB_URI: z.string().url('MONGODB_URI must be a valid URL'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL').default('redis://localhost:6379'),

  // JWT — Rule 10.2: secrets must be ≥ 32 chars
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // GPS / Spatial
  GPS_JUMP_THRESHOLD_METERS: z.coerce.number().positive().default(500),
  ROUTE_MIN_COORDINATES: z.coerce.number().int().positive().default(3),

  // Cache TTLs
  HEATMAP_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  SUGGESTION_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  // Bull queue
  BULL_CONCURRENCY: z.coerce.number().int().positive().default(5),

  // MongoDB connection timeouts
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  MONGODB_SOCKET_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    // Use console.error here ONLY because the logger may not be initialized yet
    console.error(
      `[env] FATAL: Invalid environment configuration. Fix the following before starting:\n${issues}`,
    );
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
