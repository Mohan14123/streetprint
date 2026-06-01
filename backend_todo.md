# Backend Endpoints — TODO

These endpoints are needed by the frontend but have **not yet been implemented** in the backend. The frontend currently has stubs/optimistic UI for these.

---

## 1. DELETE `/api/places/:id` — Delete a Saved Place

**Status:** ✅ Already implemented by Agent J in this session

The following files were already modified:
- `backend/src/services/place.service.ts` — `deletePlace(userId, placeId)` added
- `backend/src/controllers/place.controller.ts` — `deletePlace` controller added with Zod validation
- `backend/src/routes/place.routes.ts` — `router.delete('/:id', deletePlace)` registered

**Response shape:**
```json
{ "success": true, "data": { "deleted": true }, "error": null, "meta": {...} }
```

**Rules followed:**
- Rule 7.3: userId from JWT, not request body
- Rule 11: No DB queries in controller
- Rule 6.1: Standard response envelope

---

## 2. PATCH `/api/places/:id` — Update a Saved Place

**Status:** ✅ Already implemented by Agent J in this session

The following files were already modified:
- `backend/src/services/place.service.ts` — `updatePlace(userId, placeId, updates)` added
- `backend/src/controllers/place.controller.ts` — `updatePlace` controller added with Zod validation
- `backend/src/routes/place.routes.ts` — `router.patch('/:id', updatePlace)` registered

**Request body (all optional):**
```json
{
  "label": "New Label",
  "notes": "Updated notes",
  "lat": 12.9716,
  "lng": 77.5946
}
```

**Response shape:**
```json
{ "success": true, "data": { "place": { ... } }, "error": null, "meta": {...} }
```

**Zod schema:**
```typescript
const UpdatePlaceSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  notes: z.string().max(1_000).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
```

---

## 3. GET `/api/user/export` — Export User Data

**Status:** ❌ NOT implemented — frontend shows stub "Coming soon"

**What it should do:**
- Collect all user data: profile, routes, saved places, preferences
- Return as a downloadable JSON file (or zip with GeoJSON files for routes)
- Scope everything to `req.user.userId` (Rule 7.3)

**Suggested implementation:**
```
backend/src/routes/user.routes.ts      — GET /export
backend/src/controllers/user.controller.ts — exportUserData handler
backend/src/services/user.service.ts   — aggregation logic
```

**Response:** Stream a JSON file download with `Content-Disposition: attachment`

**Data to include:**
```json
{
  "user": { "email": "...", "displayName": "...", "createdAt": "..." },
  "routes": [ { "sessionId": "...", "coordinates": [...], "tags": [...], ... } ],
  "places": [ { "label": "...", "location": {...}, "visited": true, ... } ]
}
```

**Rules to follow:**
- Rule 7.3: userId from JWT only
- Rule 2.3: Use `.limit()` on all queries — suggest 10,000 routes max
- Rule 11: All DB logic in service layer
- Rule 9.2: Log via Winston

---

## 4. DELETE `/api/user` — Delete User Account

**Status:** ❌ NOT implemented — frontend shows stub confirmation dialog

**What it should do:**
1. Verify the user's identity (require password re-entry in request body)
2. Delete all user-owned data in order:
   - All saved places (`Place.deleteMany({ user_id })`)
   - All routes (`Route.deleteMany({ user_id })`)
   - All active sessions (`RouteSession.deleteMany({ user_id })`)
   - The user document itself (`User.findByIdAndDelete(userId)`)
3. Invalidate all refresh tokens
4. Return success

**Request body:**
```json
{ "password": "current_password_for_verification" }
```

**Response shape:**
```json
{ "success": true, "data": { "deleted": true }, "error": null, "meta": {...} }
```

**Suggested implementation:**
```
backend/src/routes/user.routes.ts        — DELETE /
backend/src/controllers/user.controller.ts — deleteAccount handler
backend/src/services/user.service.ts     — cascading delete logic
```

**Rules to follow:**
- Rule 7.3: userId from JWT
- Rule 1.2: Never expose stack traces
- Rule 6.1: Standard response envelope
- Rule 9.2: Log account deletion event
- Rule 3: Graceful handling — if partial delete fails, log but continue

**Important:** Register the new router in `backend/src/app.ts`:
```typescript
import userRoutes from './routes/user.routes';
app.use('/api/user', userRoutes);
```

---

## 5. Register New Routes in app.ts

Add to `backend/src/app.ts` after the existing route registrations:
```typescript
import userRoutes from './routes/user.routes';
app.use('/api/user', userRoutes);
```

> **Note:** The places endpoints (#1 and #2) are already registered via the existing `place.routes.ts` — no changes needed in `app.ts` for those.
