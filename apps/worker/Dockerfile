# syntax=docker/dockerfile:1.7

FROM node:20-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

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

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages

RUN npm -w packages/database run prisma:generate

WORKDIR /app/apps/worker

CMD ["npm", "run", "start"]
