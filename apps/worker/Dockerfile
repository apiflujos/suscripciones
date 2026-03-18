FROM node:20-bullseye-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN npm install --include=dev \
  && npm -w packages/database run prisma:generate

WORKDIR /app/apps/worker

CMD ["npm", "run", "start"]
