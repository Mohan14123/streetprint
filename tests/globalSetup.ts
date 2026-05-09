/**
 * tests/globalSetup.ts
 * Runs BEFORE any test file or module is loaded by Jest.
 * Sets all environment variables so that src/config/env.ts Zod validation passes.
 */
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '4000';
process.env['MONGODB_URI'] = 'mongodb://localhost:27017/route_memory_test';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['JWT_ACCESS_SECRET'] = 'test-access-secret-at-least-32-characters-long!!';
process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret-at-least-32-characters-long!!';
process.env['JWT_ACCESS_EXPIRY'] = '15m';
process.env['JWT_REFRESH_EXPIRY'] = '7d';
process.env['GPS_JUMP_THRESHOLD_METERS'] = '500';
process.env['ROUTE_MIN_COORDINATES'] = '3';
process.env['HEATMAP_CACHE_TTL_SECONDS'] = '300';
process.env['SUGGESTION_CACHE_TTL_SECONDS'] = '600';
process.env['BULL_CONCURRENCY'] = '1';
process.env['MONGODB_SERVER_SELECTION_TIMEOUT_MS'] = '5000';
process.env['MONGODB_SOCKET_TIMEOUT_MS'] = '45000';
