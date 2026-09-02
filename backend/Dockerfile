# Stage 1: Build native dependencies
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY shared ./shared
COPY backend ./backend

RUN npm ci --build-from-source
RUN npm prune --omit=dev

# Stage 2: Production runtime
FROM node:20-slim

RUN useradd -m -u 1001 appuser

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV JOBS_DB_PATH=/app/data/jobs.db

EXPOSE 3001

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY shared ./shared
COPY backend ./backend

RUN npm install -g tsx typescript
RUN mkdir -p /app/data && chown -R appuser:appuser /app

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})" || exit 1

CMD ["tsx", "backend/src/server.ts"]
