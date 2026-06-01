# 🗺️ StreetPrint

**StreetPrint** is a production-grade geospatial route tracking platform that records your movement through a city, generates movement heatmaps, surfaces unexplored nearby areas, and lets you bookmark places you want to visit.

> Built with Node.js + Express (backend) and React + Vite + Leaflet (frontend) — fully Dockerised.

---

## ✨ Features

- **📍 Real-time GPS Tracking** — Live route recording with Kalman filter noise reduction and adaptive polling
- **🔥 Movement Heatmap** — Visualise where you've been most with zoom-adaptive intensity circles
- **🗺️ Interactive Map** — Leaflet-powered dark map with re-center control, POI discovery (Overpass API), and Nominatim geocoding search
- **📂 Route History** — Browse all past routes with polyline replay, distance, duration, and status badges
- **📌 Saved Places** — Bookmark places with labels and notes; mark as visited, edit or delete via context menu
- **💡 Suggestions** — Discover unexplored zones and popular nearby routes
- **🔐 Auth** — JWT access + refresh token pair, session restore, GDPR-compliant data export and account deletion
- **📶 Offline-first** — IndexedDB sync engine + service worker with background sync fallback
- **👤 Profile & Stats** — Total distance walked, route count, day streak, places saved — live from the backend

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend runtime** | Node.js 20 + TypeScript |
| **Backend framework** | Express.js |
| **Database** | MongoDB 7 (GeoJSON + 2dsphere indexes) |
| **Cache / Queue** | Redis 7 + Bull (async GPS batch writes) |
| **Auth** | JWT (access + refresh, Redis token revocation) |
| **Validation** | Zod |
| **Logging** | Winston + Morgan |
| **Testing** | Jest + Supertest + mongodb-memory-server |
| **Frontend framework** | React 18 + Vite + TypeScript |
| **Map** | Leaflet + React-Leaflet |
| **Data fetching** | TanStack React Query |
| **Styling** | Tailwind CSS v4 |
| **Offline** | IndexedDB (localDb) + Service Worker + Background Sync |
| **Deployment** | Docker + Docker Compose |

---

## 📁 Project Structure

```
streetprint/
├── backend/                  # Express API
│   ├── src/
│   │   ├── config/           # DB, Redis, env validation, logger
│   │   ├── controllers/      # Thin HTTP layer → service
│   │   ├── middleware/       # Auth, rate limiter, error handler
│   │   ├── models/           # Mongoose schemas (2dsphere indexes)
│   │   ├── routes/           # Express routers
│   │   ├── services/         # Business logic + DB access
│   │   ├── jobs/             # Bull queue workers
│   │   └── utils/            # Geo utils, polyline encoder, response helpers
│   ├── tests/                # Jest + Supertest integration tests
│   └── server.ts             # Entry point + graceful shutdown
│
├── frontend/                 # React + Vite SPA
│   ├── src/
│   │   ├── api/              # Typed fetch clients (auth, routes, places, heatmap…)
│   │   ├── components/       # Reusable UI components
│   │   ├── contexts/         # AuthContext, QueryClient
│   │   ├── hooks/            # useAuth, useSSE, custom hooks
│   │   ├── lib/              # localDb, syncEngine, sseClient
│   │   ├── pages/            # MapView, RoutesView, DiscoverView, ProfileView
│   │   └── utils/            # KalmanFilter, motionFilter, overpassApi
│   ├── public/               # Static assets + sw.js
│   └── index.html
│
├── docker-compose.yml        # Full-stack compose file
└── package.json              # Root: concurrent dev/build scripts
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 9
- **Docker** + **Docker Compose** (recommended)

### With Docker (recommended)

```bash
git clone https://github.com/Mohan14123/streetprint.git
cd streetprint

# Copy and configure backend environment
cp backend/.env.example backend/.env
# Edit backend/.env — at minimum set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET

docker-compose up --build
```

Services started:
| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3000 |
| MongoDB | mongodb://localhost:27017 |
| Redis | redis://localhost:6379 |

### Without Docker

```bash
# 1. Install all dependencies
npm install

# 2. Install sub-package dependencies
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# 3. Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env

# 4. Run both frontend and backend concurrently
npm run dev
```

---

## ⚙️ Environment Variables

Copy `backend/.env.example` to `backend/.env` and set:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_ACCESS_SECRET` | ✅ | — | Min 32-char secret for access tokens |
| `JWT_REFRESH_SECRET` | ✅ | — | Min 32-char secret for refresh tokens |
| `MONGODB_URI` | — | `mongodb://localhost:27017/route_memory` | MongoDB connection string |
| `REDIS_URL` | — | `redis://localhost:6379` | Redis connection string |
| `PORT` | — | `3000` | API server port |
| `GPS_JUMP_THRESHOLD_METERS` | — | `500` | Max distance between GPS points before rejection |
| `ROUTE_MIN_COORDINATES` | — | `3` | Minimum points for a valid route |

> **Docker users:** Set `MONGODB_URI=mongodb://mongo:27017/route_memory` and `REDIS_URL=redis://redis:6379`

---

## 🔌 API Reference

All responses use a standard envelope:

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "meta": { "requestId": "uuid", "timestamp": "ISO8601" }
}
```

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/register` | ❌ | Register: `{ email, password, displayName }` |
| `POST` | `/api/auth/login` | ❌ | Login → JWT pair |
| `POST` | `/api/auth/refresh` | ❌ | Refresh access token |
| `POST` | `/api/auth/logout` | ✅ | Revoke refresh token |

### Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/route/start` | ✅ | Begin route session → `{ sessionId, routeId }` |
| `POST` | `/api/route/update` | ✅ | Push GPS batch: `{ sessionId, coordinates }` (60 req/min) |
| `POST` | `/api/route/end` | ✅ | End session: `{ sessionId, tags? }` |
| `GET` | `/api/route` | ✅ | Route history |

### Heatmap & Suggestions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/heatmap?bounds=minLng,minLat,maxLng,maxLat` | ✅ | Movement density heatmap (30 req/min) |
| `GET` | `/api/suggestions?lat=&lng=&radiusMeters=` | ✅ | Unexplored zones + popular routes (30 req/min) |

### Places

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/places/save` | ✅ | Save place (deduplicates within 10m) |
| `GET` | `/api/places` | ✅ | List saved places |
| `PATCH` | `/api/places/:id` | ✅ | Update place |
| `DELETE` | `/api/places/:id` | ✅ | Delete place |

### User

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/user/stats` | ✅ | Distance, route count, day streak, places count |
| `GET` | `/api/user/export` | ✅ | GDPR data export (JSON download) |
| `DELETE` | `/api/user` | ✅ | Cascade delete account (routes → places → tokens → user) |

### Other

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | ❌ | Health check |
| `GET` | `/api/sse` | ✅ | Server-Sent Events stream |

---

## 🧪 Tests

```bash
cd backend
npm test
```

Uses **mongodb-memory-server** (no real DB needed) and **ioredis-mock**.

Test files:
- `auth.test.ts` — JWT middleware, token refresh
- `route.test.ts` — Route session lifecycle, GPS noise filtering
- `heatmap.test.ts` — Heatmap aggregation and caching
- `place.test.ts` — Place saving and 10m deduplication

---

## 🏛️ Architecture Highlights

- **All GPS writes are queued** via Bull — `/route/update` never writes directly to MongoDB, preventing HTTP timeouts under high-frequency GPS updates.
- **Routes are never simplified** — StreetPrint stores the exact path walked. Douglas-Peucker and similar algorithms are explicitly forbidden.
- **Redis is optional** — if Redis is unavailable, caching and rate limiting are disabled gracefully; the app continues serving from MongoDB.
- **Graceful shutdown** — strict 5-step sequence: close HTTP → drain queue → close MongoDB → close Redis → exit (10s hard deadline).
- **Offline-first frontend** — IndexedDB queues GPS data when offline; service worker syncs on reconnect.

---

## 🛣️ Roadmap

- [ ] Email verification + password reset flow
- [ ] Route replay animation
- [ ] GPX / KML import & export
- [ ] Dark / Light theme toggle
- [ ] Push notifications
- [ ] Route tags & auto-categorisation
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Production deployment (Atlas + managed Redis)
- [ ] ML-based route suggestions

---

## 📄 License

MIT
