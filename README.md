# Route Memory Platform (FS-MAP)

A production-grade geospatial route tracking platform designed for capturing, processing, and analyzing geospatial routes and heatmaps. 

## Features

- **Geospatial Tracking:** Core engine for recording tracking paths.
- **Queue-based Processing:** Built with Bull and Redis for asynchronous background job execution and processing of incoming coordinates.
- **Heatmap Generation:** Efficient geospatial queries and heatmap rendering APIs.
- **Robust Authentication:** Secured via JSON Web Tokens (JWT) and Bcrypt hashing.
- **Data Integrity:** Graceful shutdown implementations to ensure zero-loss during processing.
- **TypeScript First:** Strongly typed architecture focusing on long-term maintainability.

## Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** MongoDB (via Mongoose), Redis (via ioredis)
- **Language:** TypeScript
- **Task Queue:** Bull
- **Validation:** Zod

## Prerequisites

- Node.js (>=20.0.0)
- MongoDB
- Redis server

## Environment Setup

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Ensure the following variables are configured:
- `PORT`
- `MONGODB_URI`
- `REDIS_HOST`
- `REDIS_PORT`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`

## Installation

```bash
npm install
```

## Running the Application

**Development Mode:**
```bash
npm run dev
```

**Production Build & Run:**
```bash
npm run build
npm start
```

## Scripts

- `npm run build`: Compile TypeScript files.
- `npm run start`: Start the production server.
- `npm run dev`: Start the development server with live reload.
- `npm run typecheck`: Run TypeScript compiler type-checking without emitting files.
- `npm run lint`: Lint the codebase.
- `npm run test`: Run the Jest test suite.

## License

ISC License
