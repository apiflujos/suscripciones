# syntax=docker/dockerfile:1.7

FROM node:20-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1
ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ENV NPM_CONFIG_FETCH_RETRIES=5
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000

FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json

RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

RUN npm install --no-save -w apps/admin \
    typescript \
    @types/node \
    @types/react \
    @types/react-dom

FROM base AS builder
WORKDIR /app

ENV NODE_ENV=production
ENV DOCKER_BUILD=1
ENV NEXT_IGNORE_INCORRECT_LOCKFILE=1
ENV NEXT_DISABLE_TYPESCRIPT=1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json
COPY . .

RUN npm run db:generate
RUN --mount=type=cache,target=/app/apps/admin/.next/cache \
    npm run build -w apps/admin

RUN mkdir -p /app/apps/admin/.next/standalone/apps/admin/.next \
  && cp -R /app/apps/admin/public /app/apps/admin/.next/standalone/apps/admin/public \
  && cp -R /app/apps/admin/.next/static /app/apps/admin/.next/standalone/apps/admin/.next/static

FROM node:20-slim AS runner
WORKDIR /app/apps/admin

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3002
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/apps/admin/.next/standalone ./
COPY --from=builder /app/apps/admin/.next/static ./.next/static
COPY --from=builder /app/apps/admin/public ./public

EXPOSE 3002

CMD ["node", "apps/admin/server.js"]
