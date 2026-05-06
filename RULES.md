# rules.md — Route Memory Platform

> These rules are non-negotiable constraints for every contributor, AI agent, and automated system working on this codebase. They exist to keep the system alive, correct, and production-safe at all times.

---

## 1. Process Stability — The System Must Not Crash

### 1.1 Global Error Boundaries
- Register `process.on('uncaughtException')` and `process.on('unhandledRejection')` in `server.ts` before any other code runs.
- These handlers must **log the full error with stack trace**, then initiate graceful shutdown. They must never silently swallow errors.
- After an uncaught exception, always exit the process (`process.exit(1)`) after cleanup. Do not attempt to continue running in an unknown state.

### 1.2 Express Error Middleware
- The global error handler middleware must be the **last middleware registered** in `app.ts`.
- It must catch all errors thrown or passed via `next(err)` in any route or middleware.
- It must **never** send a response after headers are already sent (check `res.headersSent`).
- In `production`, never include stack traces in API error responses. In `development`, include them.

### 1.3 Async Route Handlers
- Every async Express handler must be wrapped in a try/catch that calls `next(err)`.
- Alternatively, use a wrapper utility like `asyncHandler(fn)` universally. Never leave unhandled promise rejections in route handlers.

---

## 2. Database Rules

### 2.1 MongoDB Connection
- Connect to MongoDB before starting the HTTP server. If the initial connection fails → log and exit.
- After initial connection, if MongoDB disconnects during runtime → log a warning, begin reconnection with exponential backoff (delays: 1s, 2s, 4s, 8s, max 5 attempts).
- If reconnection fails after 5 attempts → log critical error and initiate graceful shutdown.
- Never let the app serve traffic in a state where all DB operations will fail silently.

### 2.2 Indexes Are Mandatory
- All `2dsphere` indexes must be declared in the Mongoose model schema definition using `index: '2dsphere'`.
- Never run geospatial queries on unindexed fields — MongoDB will throw, and the app must surface this clearly at startup.
- On app startup, call `Model.syncIndexes()` for all models. If index creation fails → exit(1).

### 2.3 Query Safety
- Always apply timeouts to MongoDB queries: set `serverSelectionTimeoutMS` and `socketTimeoutMS` in the connection options.
- Never run unbounded queries. All collection scans must have a `.limit()`.
- All geospatial queries must include a `$geoWithin` or `$near` + `$maxDistance` constraint to prevent full collection scans.

### 2.4 No Silent Failures on Writes
- If a MongoDB write fails (after retries), it must be logged with: `routeId`, `userId`, `operation`, `errorCode`, `timestamp`.
- Failed writes must be queued for retry (see Section 4). Never drop data silently.

---

## 3. Redis Rules

### 3.1 Redis Is Optional Infrastructure
- The system must function without Redis. If Redis is unavailable, caching is disabled and all reads fall through to MongoDB.
- Redis disconnect → log warning, set a flag `cacheAvailable = false`, skip all cache reads/writes.
- Redis reconnect → log info, set `cacheAvailable = true`, resume normal caching.
- Never throw an error to the user because Redis is down.

### 3.2 Cache Key Naming Convention
```
heatmap:{boundsHash}:{userId|"global"}
suggestions:{userId}:{lat4dp}:{lng4dp}
session:refresh:{userId}:{tokenId}
```
All cache keys must be namespaced. Never use bare keys.

### 3.3 TTL Is Always Required
- Every `SET` operation in Redis must include a TTL. Never store without expiry.
- Heatmap cache TTL: `HEATMAP_CACHE_TTL_SECONDS` (default 300)
- Suggestion cache TTL: `SUGGESTION_CACHE_TTL_SECONDS` (default 600)
- Refresh token TTL: match `JWT_REFRESH_EXPIRY` exactly

---

## 4. Queue Rules (Bull)

### 4.1 All Coordinate Writes Are Queued
- The `/route/update` endpoint must never directly write to MongoDB.
- It pushes a job to `routeWriterQueue` and responds immediately with `{ accepted, rejected }`.
- This is non-negotiable. Blocking HTTP on DB writes under GPS update frequency will cause timeouts.

### 4.2 Retry Policy
- All queue jobs must have retry configuration: `attempts: 3`, backoff: `{ type: 'exponential', delay: 1000 }`.
- On final failure after all retries: log the complete job data + error. Do not re-queue indefinitely.
- Failed jobs must be moved to a dead-letter set (Bull's `failed` queue) for inspection, not silently discarded.

### 4.3 Queue Worker Lifecycle
- Workers must handle `SIGTERM` gracefully: stop taking new jobs, finish current job, then shut down.
- Never `process.exit()` from inside a job handler. Throw an error and let Bull handle retries.
- Worker concurrency is controlled by `BULL_CONCURRENCY` env variable. Default: 5.

---

## 5. GPS & Spatial Data Rules

### 5.1 Coordinate Format
- All coordinates are stored and transmitted as `[longitude, latitude]` — GeoJSON standard.
- Never store `[latitude, longitude]`. Validate order at the boundary (controller/service).
- Validate WGS84 bounds: lng ∈ [-180, 180], lat ∈ [-90, 90]. Reject anything outside.

### 5.2 GPS Noise Filtering
- Any coordinate where `haversineDistance(prev, current) > GPS_JUMP_THRESHOLD_METERS` (default 500m) must be **silently rejected**.
- Rejected points are logged at `debug` level: `{ routeId, sessionId, rejectedCoord, distanceMeters }`.
- Never throw an error or return 4xx because a GPS point was noisy. Return `{ accepted: N, rejected: M }`.

### 5.3 Route Preservation
- **Never simplify, smooth, or optimize stored routes.** Douglas-Peucker and similar algorithms are explicitly forbidden.
- The stored geometry must represent the exact path the user walked, minus only noise-filtered outliers.
- If a frontend needs a simplified preview → compute it at read-time for the response, never write simplified data to the DB.

### 5.4 Minimum Route Length
- A route with fewer than `ROUTE_MIN_COORDINATES` valid points (default: 3) after filtering must be set to `status: "abandoned"` and must not appear in community queries.
- This check happens at `/route/end`.

### 5.5 Long Route Handling
- Routes with > 500 coordinate pairs must have their geometry encoded using Google Polyline format before storage.
- Store a `isPolylineEncoded: boolean` flag on the document.
- Decode transparently on read so consumers always receive GeoJSON coordinates.

---

## 6. API Contract Rules

### 6.1 Consistent Response Shape
All responses must follow:
```json
{
  "success": true | false,
  "data": { ... } | null,
  "error": null | { "code": "ROUTE_NOT_FOUND", "message": "..." },
  "meta": { "requestId": "uuid", "timestamp": "ISO8601" }
}
```
Never return raw objects, arrays, or plain strings as top-level responses.

### 6.2 Error Codes Are Strings
- Use namespaced string error codes: `ROUTE_NOT_FOUND`, `SESSION_ALREADY_ACTIVE`, `GPS_INVALID`, `AUTH_TOKEN_EXPIRED`.
- HTTP status codes alone are insufficient. Always include a machine-readable error code in the body.

### 6.3 Auth Is Required Everywhere
- All routes except `POST /auth/register` and `POST /auth/login` require a valid JWT in the `Authorization: Bearer <token>` header.
- Expired tokens return `401`. Invalid tokens return `401`. Missing tokens return `401`. Never return `403` for auth failures — `403` is for authorization (you're authenticated but not permitted).

### 6.4 Input Validation
- All request bodies and query strings must be validated with Zod schemas before reaching the service layer.
- Validation failures return `400` with a detailed list of field errors.
- Never let unvalidated data reach MongoDB queries.

### 6.5 Rate Limiting
- `/route/update` is rate-limited to 60 requests/minute per user. Exceeds return `429`.
- `/heatmap` and `/suggestions` are rate-limited to 30 requests/minute per user.
- Rate limits are enforced at the middleware level using Redis. If Redis is down, rate limiting is skipped (fail open — do not block the request).

---

## 7. Privacy Rules

### 7.1 No Real-Time Location Exposure
- Active (in-progress) routes must never be returned in any public-facing API response.
- Only routes with `status: "completed"` and `isPublic: true` are eligible for community queries.

### 7.2 Visibility Toggle
- `isPublic` is a first-class field on every Route document.
- All aggregation queries for heatmap and suggestions must filter `isPublic: true` unless the querying user is the route owner.
- Changing `isPublic` to `false` must take effect immediately. Do not rely on cache TTL expiry — invalidate the relevant heatmap and suggestion cache keys synchronously.

### 7.3 User Data Isolation
- A user must never be able to access another user's private routes, bookmarks, or active session IDs.
- All service-layer functions that retrieve user-specific data must accept and enforce `userId` from the JWT, not from the request body.

---

## 8. Graceful Shutdown Rules

On receiving `SIGTERM` or `SIGINT`:
1. Call `server.close()` to stop accepting new HTTP connections.
2. Set a deadline of 10 seconds for in-flight requests to complete.
3. Call `routeWriterQueue.close()` to stop accepting new queue jobs (finish current).
4. Close the MongoDB connection.
5. Close the Redis connection.
6. Log `"Shutdown complete"` and call `process.exit(0)`.

If the 10-second deadline is exceeded → force `process.exit(1)` and log a warning.

---

## 9. Logging Rules

### 9.1 Log Levels
| Level | When to Use |
|---|---|
| `error` | Unhandled exceptions, DB failures, queue final failures |
| `warn` | Redis disconnect, GPS jump rejection patterns, retries triggered |
| `info` | Server start/stop, route completed, user registered |
| `debug` | Individual GPS point rejection, cache hit/miss, queue job details |

### 9.2 Structured Logging
- All logs must be structured JSON in production.
- Every log entry must include: `level`, `message`, `timestamp`, `service: "route-memory"`.
- Route-related logs must include `routeId` and `userId` where available.
- Never log JWT tokens, passwords, or raw GPS coordinates for users who have `isPublic: false`.

### 9.3 No Console.log in Production
- `console.log` and `console.error` are forbidden in application code. Use the Winston logger exclusively.
- Linting should enforce this with `no-console` rule set to `error`.

---

## 10. Environment & Configuration Rules

### 10.1 Startup Validation
- All environment variables must be validated with Zod at application startup before any connections are established.
- If any required variable is missing or invalid → log a clear message listing the failing variables and call `process.exit(1)`.
- Never use `process.env.VARIABLE` directly in service or controller code. Import from `src/config/env.ts`.

### 10.2 Secrets
- JWT secrets must be at least 32 characters. Enforce this in the Zod schema.
- Never commit `.env` files. Only `.env.example` is committed.
- Never log env variable values (even in debug mode).

### 10.3 No Hardcoded Values
- No hardcoded ports, connection strings, thresholds, TTLs, or limits anywhere in source code.
- All tuneable values live in `.env` with sensible defaults defined in `src/config/env.ts`.

---

## 11. Code Quality Rules

- **TypeScript strict mode** (`"strict": true` in `tsconfig.json`). No `any` types.
- All service functions must have explicit return types.
- No business logic in route handlers. Controllers are thin — they validate input, call services, and format responses.
- No database queries in controllers. All DB access is in the service layer.
- All utility functions in `src/utils/` must be pure (no side effects).
- Tests must cover: happy path, GPS noise rejection, DB failure fallback, and auth failure for every major feature.

---

## 12. What Is Explicitly Forbidden

| Forbidden | Reason |
|---|---|
| Route simplification algorithms | Destroys path accuracy — core product value |
| Synchronous GPS writes to MongoDB | Causes timeout under load |
| Geospatial queries without index | Full collection scan, will kill performance |
| `process.exit()` inside job handlers | Kills the worker mid-job, corrupts queue state |
| Unbounded MongoDB queries | Will OOM under production data volumes |
| Exposing active session routes publicly | Privacy violation |
| Storing coordinates as `[lat, lng]` | Violates GeoJSON standard, breaks all spatial queries |
| Hardcoded secrets or connection strings | Security violation |
| Silent data loss on write failure | Data integrity violation |
| `console.log` in application code | Non-structured, uncontrollable in production |


## 13. Use a Completed.md and TODO.md
When I ask you to start, you must first check if `completed.md` and `TODO.md` exists. If it does, you must read it and understand what has been done and what needs to be done. If it does not, you must create it and explain that it has been created. 

ALSO add the Agent name to end of each task