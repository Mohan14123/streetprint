# TODO.md — Route Memory Platform

Tracks pending and in-progress tasks.

---

## Phase 1 — Scaffold + Config + Models + Utils ✅ COMPLETE
- [x] Scaffold full directory structure — Agent Lawson
- [x] src/config/env.ts — Agent Lawson
- [x] src/config/logger.ts — Agent Lawson
- [x] src/config/db.ts — Agent Lawson
- [x] src/config/redis.ts — Agent Lawson
- [x] src/models/User.ts — Agent Lawson
- [x] src/models/Route.ts — Agent Lawson
- [x] src/models/Place.ts — Agent Lawson
- [x] src/utils/geoUtils.ts — Agent Lawson
- [x] src/utils/polylineEncoder.ts — Agent Lawson
- [x] src/utils/responseHelper.ts — Agent Lawson
- [x] src/types/index.ts — Agent Lawson

## Phase 2 — Services (Awaiting approval)
- [ ] src/services/route.service.ts
- [ ] src/services/heatmap.service.ts
- [ ] src/services/suggestion.service.ts
- [ ] src/services/place.service.ts
- [ ] src/services/queue.service.ts

## Phase 3 — Controllers + Routes + Middleware (Pending)
- [ ] src/controllers/route.controller.ts
- [ ] src/controllers/heatmap.controller.ts
- [ ] src/controllers/suggestion.controller.ts
- [ ] src/controllers/place.controller.ts
- [ ] src/routes/route.routes.ts
- [ ] src/routes/heatmap.routes.ts
- [ ] src/routes/suggestion.routes.ts
- [ ] src/routes/place.routes.ts
- [ ] src/routes/auth.routes.ts
- [ ] src/middleware/auth.ts
- [ ] src/middleware/errorHandler.ts
- [ ] src/middleware/rateLimiter.ts
- [ ] src/middleware/requestLogger.ts

## Phase 4 — App + Server + Jobs (Pending)
- [ ] src/app.ts
- [ ] server.ts
- [ ] src/jobs/routeWriter.job.ts

## Phase 5 — Tests + Docker (Pending)
- [ ] tests/route.test.ts
- [ ] tests/heatmap.test.ts
- [ ] tests/suggestion.test.ts
- [ ] Dockerfile
- [ ] docker-compose.yml
- [ ] .env.example
- [ ] README.md
