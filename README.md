# Route Memory Platform

A production-grade geospatial platform that tracks, stores, and visualizes user movement in a city. Users explore their city and the app remembers every path they've taken — generating heatmaps of movement density, suggesting unexplored areas, and letting users bookmark places they want to visit.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 (TypeScript) |
| Framework | Express.js |
| Database | MongoDB 7 (GeoJSON + 2dsphere indexes) |
| Cache | Redis 7 (heatmap + suggestion caching) |
| Auth | JWT (access + refresh token pattern) |
| Queue | Bull (Redis-backed job queue for batch GPS writes) |
| Validation | Zod |
| Logging | Winston + Morgan |
| Testing | Jest + Supertest + mongodb-memory-server |
| Deployment | Docker + Docker Compose |

---

## Setup

### Prerequisites

- **Node.js** ≥ 20.0.0
- **npm** ≥ 9
- **Docker** and **Docker Compose** (for containerised runs)
- **MongoDB** 7+ and **Redis** 7+ (if running without Docker)

### Clone and Configure

```bash
git clone https://github.com/Mohan14123/route-memory-platform.git
cd route-memory-platform

# Copy the example env file and fill in your secrets
cp .env.example .env
```

Open `.env` and set the **required** values:

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_ACCESS_SECRET` | ✅ | Secret for signing access tokens (min 32 chars) |
| `JWT_REFRESH_SECRET` | ✅ | Secret for signing refresh tokens (min 32 chars) |

All other variables have sensible defaults for local development.

> **Docker Compose users:** Update `MONGODB_URI` and `REDIS_URL` to use container hostnames:
> ```
> MONGODB_URI=mongodb://mongo:27017/route_memory
> REDIS_URL=redis://redis:6379
> ```

---

## Run Locally

### With Docker (recommended)

```bash
docker-compose up --build
```

This starts three services:
- **api** — Express server on port 3000
- **mongo** — MongoDB 7 with persistent volume
- **redis** — Redis 7 Alpine

The API waits for MongoDB and Redis health checks to pass before starting.

### Without Docker

Make sure MongoDB and Redis are running locally, then:

```bash
npm install
npm run dev
```

The server starts on `http://localhost:3000` (or the port configured in `.env`).

### Other Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Start production build (`node dist/server.js`) |
| `npm run dev` | Start dev server with hot reload |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Run ESLint |
| `npm test` | Run Jest integration tests |

---

## Run Tests

```bash
npm test
```

Tests use **mongodb-memory-server** for an in-memory MongoDB instance — no real database needed. Redis is mocked with `ioredis-mock` and the Bull queue is mocked to write directly to the test database.

Test files:
- `tests/route.test.ts` — Route session lifecycle, GPS noise filtering
- `tests/heatmap.test.ts` — Heatmap aggregation and caching
- `tests/place.test.ts` — Place saving and 10m deduplication
- `tests/auth.test.ts` — JWT auth middleware, token refresh

---

## API Reference

All responses follow a standard envelope:

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "meta": { "requestId": "uuid", "timestamp": "ISO8601" }
}
```

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/register` | ❌ | Register a new user. Body: `{ email, password, displayName }` |
| `POST` | `/auth/login` | ❌ | Login with email + password. Returns JWT pair. |
| `POST` | `/auth/refresh` | ❌ | Exchange a valid refresh token for a new access token. |
| `POST` | `/auth/logout` | ✅ | Revoke a refresh token. Body: `{ refreshToken }` |
| `POST` | `/route/start` | ✅ | Begin a new route session. Returns `{ sessionId, routeId }`. |
| `POST` | `/route/update` | ✅ | Push GPS coordinate batch. Body: `{ sessionId, coordinates }`. Rate: 60 req/min. |
| `POST` | `/route/end` | ✅ | End a route session. Body: `{ sessionId, tags? }`. |
| `GET` | `/route` | ✅ | Get the authenticated user's route history. |
| `GET` | `/heatmap?bounds=minLng,minLat,maxLng,maxLat&userId=` | ✅ | Get movement density heatmap for a bounding box. Rate: 30 req/min. |
| `GET` | `/suggestions?lat=&lng=&radiusMeters=` | ✅ | Get unexplored zones and popular nearby routes. Rate: 30 req/min. |
| `POST` | `/places/save` | ✅ | Save a place. Body: `{ label, lat, lng, notes? }`. Deduplicates within 10m. |
| `GET` | `/places?visited=true\|false` | ✅ | Get all saved places for the authenticated user. |
| `PATCH` | `/places/:id/visited` | ✅ | Mark a saved place as visited. |
| `GET` | `/health` | ❌ | Health check endpoint. |

### Authentication

All protected endpoints require a JWT access token in the `Authorization` header:

```
Authorization: Bearer <accessToken>
```

- **Access tokens** expire in 15 minutes (configurable via `JWT_ACCESS_EXPIRY`).
- **Refresh tokens** expire in 7 days (configurable via `JWT_REFRESH_EXPIRY`).
- All auth failures return **HTTP 401** — never 403.

---

## GPS Filtering Behaviour

### Why routes are never simplified

Route Memory stores the **exact GPS path** the user walked. Route simplification algorithms like Douglas-Peucker are **explicitly forbidden** because they destroy the path accuracy that is the core product value.

### Noise filtering

Raw GPS data contains noise — random jumps caused by signal reflection, satellite switching, or brief loss of fix. The system applies a single filter:

> **Any coordinate where the Haversine distance from the previous accepted point exceeds `GPS_JUMP_THRESHOLD_METERS` (default: 500m) is silently rejected.**

- Rejected points are logged at `debug` level with `{ routeId, sessionId, rejectedCoord, distanceMeters }`.
- The API never returns an error for noisy GPS — it responds with `{ accepted: N, rejected: M }`.
- The threshold is configurable via the `GPS_JUMP_THRESHOLD_METERS` environment variable.

### Coordinate format

All coordinates use **GeoJSON order: `[longitude, latitude]`**. This is enforced at every boundary (controllers, services, models). The system validates WGS84 bounds: `lng ∈ [-180, 180]`, `lat ∈ [-90, 90]`.

### Minimum route length

Routes with fewer than `ROUTE_MIN_COORDINATES` (default: 3) valid points after filtering are automatically set to `status: "abandoned"` and excluded from community queries.

---

## Architecture

```
server.ts                  ← Entry point, global error handlers, graceful shutdown
└── src/
    ├── config/            ← DB, Redis, env validation, logger
    ├── middleware/         ← Auth, error handler, rate limiter, request logger
    ├── models/            ← Mongoose schemas with 2dsphere indexes
    ├── routes/            ← Express router definitions
    ├── controllers/       ← Thin HTTP layer: validate → call service → respond
    ├── services/          ← Business logic, all DB access
    ├── jobs/              ← Bull queue workers
    ├── utils/             ← Pure functions: geo, polyline, response helpers
    └── types/             ← Shared TypeScript interfaces
```

### Key design decisions

- **All GPS writes are queued** via Bull — the `/route/update` endpoint never writes directly to MongoDB. This prevents HTTP timeouts under high-frequency GPS updates.
- **Redis is optional** — if Redis goes down, caching is disabled and rate limiting is skipped. The app continues serving requests from MongoDB.
- **Graceful shutdown** follows a strict 5-step sequence: close HTTP → drain queue → close MongoDB → close Redis → exit. A 10-second hard deadline forces exit if cleanup stalls.

---

## License

MIT
