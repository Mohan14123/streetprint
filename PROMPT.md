# Claude Code Prompt — Route Memory Platform (MVP)

## Project Overview

You are building **Route Memory**, a production-grade geospatial platform that tracks, stores, and visualizes user movement in a city. Users explore their city, and the app remembers every path they've taken, generates heatmaps of movement density, suggests unexplored areas, and lets users bookmark places they want to visit.

This is a **real deployable system**. Design every layer for resilience, correctness, and horizontal scalability from day one.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (TypeScript) |
| Framework | Express.js |
| Database | MongoDB Atlas (with GeoJSON + 2dsphere indexes) |
| Cache | Redis (heatmap + suggestion caching) |
| Auth | JWT (access + refresh token pattern) |
| Queue / Local Sync | Bull (Redis-backed job queue for batch writes and retries) |
| Validation | Zod |
| Logging | Winston + Morgan |
| Testing | Jest + Supertest |
| Deployment-Ready | Dockerfile + docker-compose |

---

## Project Structure to Generate

```
route-memory/
├── src/
│   ├── config/
│   │   ├── db.ts               # MongoDB connection with retry logic
│   │   ├── redis.ts            # Redis connection with retry logic
│   │   ├── env.ts              # Zod-validated environment variables
│   │   └── logger.ts           # Winston logger setup
│   ├── middleware/
│   │   ├── auth.ts             # JWT verification middleware
│   │   ├── errorHandler.ts     # Global error handler (never crashes the process)
│   │   ├── rateLimiter.ts      # Per-user rate limiting on write APIs
│   │   └── requestLogger.ts    # HTTP request logging
│   ├── models/
│   │   ├── User.ts             # User schema
│   │   ├── Route.ts            # Route schema (GeoJSON LineString)
│   │   └── Place.ts            # Saved places schema (GeoJSON Point)
│   ├── routes/
│   │   ├── route.routes.ts     # /route/start, /route/update, /route/end
│   │   ├── heatmap.routes.ts   # /heatmap
│   │   ├── suggestion.routes.ts# /suggestions
│   │   ├── place.routes.ts     # /places/save, /places
│   │   └── auth.routes.ts      # /auth/register, /auth/login, /auth/refresh
│   ├── controllers/
│   │   ├── route.controller.ts
│   │   ├── heatmap.controller.ts
│   │   ├── suggestion.controller.ts
│   │   └── place.controller.ts
│   ├── services/
│   │   ├── route.service.ts    # Core route logic, GPS filtering, session management
│   │   ├── heatmap.service.ts  # Aggregation + density computation
│   │   ├── suggestion.service.ts # Unexplored zone + popular route logic
│   │   ├── place.service.ts    # Bookmark CRUD
│   │   └── queue.service.ts    # Bull queue setup for batch writes + retries
│   ├── utils/
│   │   ├── geoUtils.ts         # Haversine distance, GPS noise filter, bounds parser
│   │   ├── polylineEncoder.ts  # Google Polyline encoding for long routes
│   │   └── responseHelper.ts   # Standardized API response shapes
│   ├── types/
│   │   └── index.ts            # Shared TypeScript interfaces
│   ├── jobs/
│   │   └── routeWriter.job.ts  # Bull worker: dequeues batched coordinate writes
│   └── app.ts                  # Express app setup (no server.listen here)
├── server.ts                   # Entry point — process error handlers here
├── tests/
│   ├── route.test.ts
│   ├── heatmap.test.ts
│   └── suggestion.test.ts
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── rules.md
└── README.md
```

---

## What to Build — Detailed Instructions

### 1. Database Models

**Route Model** (`src/models/Route.ts`):
```
- user_id: ObjectId (ref: User)
- sessionId: string (UUID generated at /route/start)
- geometry: GeoJSON LineString { type: "LineString", coordinates: [[lng, lat], ...] }
- tags: string[] (optional, e.g. ["food", "exploration"])
- isPublic: boolean (default: true)
- startedAt: Date
- endedAt: Date (set at /route/end)
- status: enum ["active", "completed", "abandoned"]
- coordinateCount: number (denormalized for fast queries)
- createdAt, updatedAt
```
Index: `{ geometry: "2dsphere" }`, `{ user_id: 1, status: 1 }`, `{ isPublic: 1 }`

**Place Model** (`src/models/Place.ts`):
```
- user_id: ObjectId
- label: string
- notes: string (optional)
- location: GeoJSON Point { type: "Point", coordinates: [lng, lat] }
- visited: boolean (default: false)
- createdAt
```
Index: `{ location: "2dsphere" }`, `{ user_id: 1 }`

---

### 2. GPS Filtering Logic (`src/utils/geoUtils.ts`)

Implement the following functions:

- `haversineDistance(a, b)` → distance in meters between two [lng, lat] points
- `filterNoisyPoint(prev, next, thresholdMeters = 50)` → returns `false` if jump is impossibly large (> 500m in < 10s), returns `true` if valid
- `parseBounds(boundsString)` → parse `?bounds=minLng,minLat,maxLng,maxLat` into a MongoDB `$geoWithin` box query
- `encodePolyline(coordinates)` → Google Polyline encoding for routes with > 500 points

**GPS Jump Threshold:** Reject any coordinate update where the distance from the last stored coordinate exceeds **500 meters** (configurable via env `GPS_JUMP_THRESHOLD_METERS`). Log rejected points at debug level, never throw an error — just skip and continue.

---

### 3. Route API (`/route`)

**POST /route/start**
- Requires auth
- Creates a new Route document with `status: "active"`, empty coordinates, generates `sessionId`
- Responds with `{ sessionId, routeId }`
- If user already has an active session → auto-abandon it (set status to "abandoned") before creating a new one

**POST /route/update**
- Requires auth
- Body: `{ sessionId, coordinates: [[lng, lat, timestamp], ...] }`
- Validate sessionId belongs to authenticated user
- Filter each incoming coordinate through `filterNoisyPoint`
- Do NOT write directly to MongoDB — push to Bull queue (`routeWriterQueue`)
- Respond with `{ accepted: N, rejected: M }` immediately (never block on DB)

**POST /route/end**
- Requires auth
- Body: `{ sessionId, tags?: string[] }`
- Flush any pending queue items for this session
- Set `status: "completed"`, `endedAt: now()`
- If route has < 3 valid coordinates → set status to "abandoned", do not save as completed
- If route has > 500 points → encode geometry with polyline before storage

---

### 4. Bull Queue Worker (`src/jobs/routeWriter.job.ts`)

- Process `routeWriterQueue` jobs
- Each job: `{ routeId, coordinates: [[lng, lat]] }`
- Use `$push: { "geometry.coordinates": { $each: coordinates } }` with bulk MongoDB update
- On failure: retry up to 3 times with exponential backoff (1s, 2s, 4s)
- On final failure: log with full context, do NOT crash the worker
- Concurrency: 5 workers

---

### 5. Heatmap API (`/heatmap`)

**GET /heatmap?bounds=minLng,minLat,maxLng,maxLat&userId=optional**

Service logic (`src/services/heatmap.service.ts`):
- Query `Route` collection for all completed, public routes within bounds
- If `userId` param present → filter to that user's routes
- Use MongoDB aggregation to unwind `geometry.coordinates` and group by rounded coordinate (round to 4 decimal places ≈ 11m grid)
- Return array of `{ lat, lng, intensity }` where intensity = count of overlapping paths
- **Cache result in Redis** with key `heatmap:{boundsHash}:{userId|"global"}` TTL = 5 minutes
- Invalidate cache on new route completion (publish event via Redis pub/sub)

Response shape:
```json
{
  "points": [{ "lat": 12.97, "lng": 77.59, "intensity": 14 }],
  "generatedAt": "ISO timestamp",
  "cached": true
}
```

---

### 6. Suggestions API (`/suggestions`)

**GET /suggestions?lat=&lng=&radiusMeters=2000**

Two suggestion types returned together:

**Unexplored Zones:**
- Find areas within radius where the requesting user has NO routes
- Strategy: divide bounding box into a grid (configurable cell size, default 200m)
- Mark cells the user has covered
- Return cells with zero user coverage but nonzero community coverage (popular but unexplored by this user)
- Return top 5 such zones as GeoJSON Points

**Popular Nearby Routes:**
- Find top 5 public routes by other users that pass within `radiusMeters` of current location
- Rank by `coordinateCount` descending (longer explored = more popular)
- Return route metadata only (no full coordinate dump): `{ routeId, startedAt, coordinateCount, tags, previewPolyline (first 20 points) }`

Cache: Redis key `suggestions:{userId}:{lat4dp}:{lng4dp}` TTL = 10 minutes

---

### 7. Places API (`/places`)

**POST /places/save**
- Body: `{ label, lat, lng, notes? }`
- Validate lat/lng are valid WGS84 coordinates
- Store as GeoJSON Point
- Deduplicate: if user already has a place within 10m of this location → return existing, do not duplicate

**GET /places**
- Return all saved places for authenticated user
- Optional query: `?visited=true|false` to filter

**PATCH /places/:id/visited**
- Mark a place as visited

---

### 8. Auth System (`/auth`)

- `POST /auth/register` → hash password with bcrypt (rounds: 12), return JWT pair
- `POST /auth/login` → validate, return `{ accessToken (15min), refreshToken (7d) }`
- `POST /auth/refresh` → validate refresh token, return new access token
- Store refresh tokens in Redis with TTL (revocable)
- JWT secret from env, never hardcoded

---

### 9. Error Handling & Resilience

Implement in `src/middleware/errorHandler.ts` and `server.ts`:

- Global Express error handler: catch all thrown errors, return structured JSON, never expose stack traces in production
- `process.on('uncaughtException')` → log + graceful shutdown
- `process.on('unhandledRejection')` → log + graceful shutdown
- MongoDB disconnect → log warning, retry connection with exponential backoff (max 5 attempts), do not crash
- Redis disconnect → log warning, disable caching gracefully (fall through to DB), do not crash
- Bull queue failure → log job details with full context, continue processing other jobs

**Graceful Shutdown** (SIGTERM / SIGINT):
1. Stop accepting new HTTP connections
2. Finish in-flight requests (timeout: 10s)
3. Drain Bull queue (finish current jobs)
4. Close MongoDB connection
5. Close Redis connection
6. Exit 0

---

### 10. Environment Variables (`.env.example`)

```
NODE_ENV=development
PORT=3000

MONGODB_URI=mongodb+srv://...
REDIS_URL=redis://localhost:6379

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

GPS_JUMP_THRESHOLD_METERS=500
HEATMAP_CACHE_TTL_SECONDS=300
SUGGESTION_CACHE_TTL_SECONDS=600
BULL_CONCURRENCY=5
ROUTE_MIN_COORDINATES=3
```

All env vars must be validated at startup using Zod. If any required var is missing → log error and exit(1) immediately.

---

### 11. Docker Setup

**Dockerfile:**
- Multi-stage build (builder → production)
- Run as non-root user
- Expose PORT

**docker-compose.yml:**
- Services: `api`, `mongo`, `redis`
- Health checks on mongo and redis
- `api` waits for mongo and redis to be healthy before starting
- Volume mounts for mongo data persistence

---

### 12. Tests

Write integration tests using Jest + Supertest covering:
- `POST /route/start` → creates session
- `POST /route/update` → filters noisy GPS correctly
- `POST /route/end` → abandons route with < 3 coordinates
- `GET /heatmap` → returns cached response on second call
- `POST /places/save` → deduplicates within 10m
- Auth middleware → rejects expired tokens

Use an in-memory MongoDB (mongodb-memory-server) for tests. Mock Redis with ioredis-mock.

---

## Strict Implementation Rules

1. **Never optimize/simplify user routes.** Store exact coordinate sequences. No Douglas-Peucker or similar.
2. **Never store GPS jumps.** Filter silently, log at debug level.
3. **Never block HTTP responses on DB writes.** All coordinate writes go through Bull queue.
4. **Never expose real-time user location.** Routes are only visible after session ends.
5. **GeoJSON only.** All spatial data uses GeoJSON format internally and in API responses.
6. **2dsphere indexes.** All coordinate fields must have this index before any query runs.
7. **No duplicate routes.** Check `sessionId` uniqueness before creating a new route document.
8. **Privacy toggle is a first-class field.** Always filter on `isPublic: true` for community queries unless the requesting user owns the route.

---

## Deliverables Checklist

- [ ] All source files in `src/` with no placeholder TODOs
- [ ] Fully typed TypeScript (no `any`)
- [ ] `.env.example` with all variables documented
- [ ] `Dockerfile` + `docker-compose.yml`
- [ ] `README.md` with setup, run, and test instructions
- [ ] `rules.md` (already provided separately)
- [ ] All 2dsphere indexes created in model files
- [ ] Bull queue worker running as a separate process or co-located with graceful shutdown

Start by scaffolding the full directory structure, then implement each layer bottom-up: config → models → utils → services → controllers → routes → middleware → app → server → jobs → tests → Docker.