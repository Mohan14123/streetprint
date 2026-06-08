# ────────────────────────────────────────────────────────────────
# Route Memory Platform — Multi-stage Dockerfile
#
# Stage 1 (builder): Install all deps, compile TypeScript → dist/
# Stage 2 (production): Copy only compiled JS + prod deps, run as non-root
#
# Rule: Dockerfile must run as non-root
# Rule: No secrets committed — .env is NEVER copied into the image
# ────────────────────────────────────────────────────────────────

# ── Stage 1: Builder ────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for tsc)
RUN npm install

# Copy source code (excluding files in .dockerignore)
COPY tsconfig.json ./
COPY server.ts ./
COPY src/ ./src/

# Compile TypeScript → dist/
RUN npm run build

# ── Stage 2: Production ────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy package files and install production-only deps
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy compiled output from builder stage
COPY --from=builder /app/dist ./dist

# Switch to non-root user
USER appuser

# Expose the configured port (default 3000)
EXPOSE ${PORT:-3000}

# Start the compiled server
CMD ["node", "dist/server.js"]
