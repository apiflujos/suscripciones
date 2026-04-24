FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ \
  NPM_CONFIG_FETCH_RETRIES=5 \
  NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
  NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
  NPM_CONFIG_PREFER_ONLINE=true

COPY . .

RUN for i in 1 2 3 4 5; do npm install --legacy-peer-deps && break || (echo "npm install failed, retry $i/5" && sleep 5); done
RUN npm run db:generate
RUN npm run build -w apps/admin
RUN mkdir -p /app/apps/admin/.next/standalone/apps/admin/.next \
  && cp -R /app/apps/admin/public /app/apps/admin/.next/standalone/apps/admin/public \
  && cp -R /app/apps/admin/.next/static /app/apps/admin/.next/standalone/apps/admin/.next/static

WORKDIR /app/apps/admin

EXPOSE 3002

ENV NODE_ENV=production
CMD ["npm", "run", "start:standalone"]
