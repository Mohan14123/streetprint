<div align="center">
  <img src="https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/map-pinned.svg" alt="StreetPrint Logo" width="80" height="80">
  <h1 align="center">StreetPrint</h1>
  <p align="center">
    <strong>A production-grade geospatial route tracking platform</strong>
  </p>
  <p align="center">
    Records your movement through a city, generates beautiful movement heatmaps, surfaces unexplored nearby areas, and lets you bookmark places you want to visit.
  </p>
  <p align="center">
    <a href="#-features">Features</a> •
    <a href="#-tech-stack">Tech Stack</a> •
    <a href="#-quick-start">Quick Start</a> •
    <a href="#-api-reference">API Reference</a> •
    <a href="#-architecture-highlights">Architecture</a>
  </p>
</div>

---

## ✨ Features

- **📍 Real-time GPS Tracking** — Live route recording with Kalman filter noise reduction, adaptive polling, animated progressive route reveal, speed-based color gradients (yellow→cyan), and dynamic line widths.
- **🔥 Movement Heatmap** — Visualise where you've been most with zoom-adaptive intensity circles and custom color ramps for different modes (My Routes, Community, Unexplored).
- **🗺️ Interactive Map** — Leaflet-powered dark map with re-center control, POI discovery (Overpass API), and a rich Nominatim geocoding search with history and category emojis.
- **📂 Route History** — Browse all past routes with polyline replay, distance, duration, and status badges.
- **📌 Saved Places** — Bookmark places with labels and notes directly from the map or search results; manage them via a compact UI with context menus.
- **💡 Suggestions** — Discover unexplored zones and popular nearby routes.
- **🔐 Auth & Privacy** — JWT access + refresh token pair, session restore, and GDPR-compliant data export and cascading account deletion.
- **📶 Offline-first** — IndexedDB sync engine + service worker with background sync fallback ensures you never lose a coordinate when connection drops.
- **📱 Responsive UI** — A premium, app-like experience with glassmorphic elements, bottom-tab navigation, and fluid framer-motion animations across all devices.

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend Runtime** | Node.js 20 + TypeScript |
| **Backend Framework** | Express.js |
| **Database** | MongoDB 7 (GeoJSON + 2dsphere indexes) |
| **Cache & Queue** | Redis 7 + Bull (async GPS batch writes) |
| **Authentication** | JWT (access + refresh, Redis token revocation) |
| **Validation** | Zod |
| **Logging** | Winston + Morgan |
| **Testing** | Jest + Supertest + mongodb-memory-server |
| **Frontend Framework** | React 18 + Vite + TypeScript |
| **Map Rendering** | Leaflet + React-Leaflet |
| **Data Fetching** | TanStack React Query |
| **Styling** | Tailwind CSS v4 + Framer Motion |
| **Offline Engine** | IndexedDB (localDb) + Service Worker + Background Sync |
| **Deployment** | Docker + Docker Compose |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 9
- **Docker** & **Docker Compose** (recommended)

### With Docker (Recommended)

```bash
git clone https://github.com/Mohan14123/streetprint.git
cd streetprint

# Copy and configure backend environment
cp backend/.env.example backend/.env
# Edit backend/.env — at minimum set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET

docker-compose up --build
```

Services available at:
| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:5173 |
| **Backend API** | http://localhost:3000 |
| **MongoDB** | mongodb://localhost:27017 |
| **Redis** | redis://localhost:6379 |

### Without Docker

```bash
# 1. Install root dependencies
npm install

# 2. Install sub-package dependencies
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# 3. Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your secrets and local connection strings

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

> **Docker users:** Ensure `MONGODB_URI=mongodb://mongo:27017/route_memory` and `REDIS_URL=redis://redis:6379` when running via compose.

---

## 🔌 API Reference

All responses use a standard envelope format:

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "meta": { "requestId": "uuid", "timestamp": "ISO8601" }
}
```

### Core Endpoints

**Auth:**
- `POST /api/auth/register` — Register new user
- `POST /api/auth/login` — Login and receive JWT pair
- `POST /api/auth/refresh` — Refresh access token
- `POST /api/auth/logout` — Revoke refresh token

**Routes:**
- `POST /api/route/start` — Begin route session
- `POST /api/route/update` — Push GPS coordinate batch (60 req/min)
- `POST /api/route/end` — End route session
- `GET /api/route` — Retrieve route history

**Heatmap & Places:**
- `GET /api/heatmap?bounds=minLng,minLat,maxLng,maxLat` — Movement density heatmap
- `POST /api/places/save` — Save place (deduplicates within 10m)
- `GET /api/places` — List saved places

**User Privacy:**
- `GET /api/user/export` — GDPR data export (JSON download)
- `DELETE /api/user` — Cascade delete account (routes → places → tokens → user)

---

## 🧪 Tests

```bash
cd backend
npm test
```

Uses **mongodb-memory-server** (no real DB needed) and **ioredis-mock**.
- `auth.test.ts` — JWT middleware, token refresh
- `route.test.ts` — Route session lifecycle, GPS noise filtering
- `heatmap.test.ts` — Heatmap aggregation and caching
- `place.test.ts` — Place saving and 10m deduplication

---

## 🏛️ Architecture Highlights

- **All GPS writes are queued** via Bull — `/route/update` never writes directly to MongoDB. This prevents HTTP timeouts under high-frequency GPS updates and ensures stable backend performance.
- **Routes are never simplified** — StreetPrint stores the exact path walked. Douglas-Peucker and similar simplification algorithms are explicitly forbidden to preserve granular geospatial accuracy.
- **Redis is optional** — If Redis goes down, caching and rate limiting are disabled gracefully, and the application continues serving core functionality directly from MongoDB.
- **Graceful Shutdown** — Strict 5-step sequence: close HTTP → drain queue → close MongoDB → close Redis → exit (10s hard deadline).
- **Offline-first Frontend** — IndexedDB securely queues GPS data and saved places when offline; the service worker synchronizes on network reconnect.

---

## 📄 License

MIT
