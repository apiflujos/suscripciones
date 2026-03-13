FROM node:20-alpine

WORKDIR /app

# Instalar OpenSSL 1.1 (requerido por Prisma)
RUN apk add --no-cache openssl1.1-compat

COPY . .

WORKDIR /app/apps/api
RUN npm install --legacy-peer-deps
RUN npx prisma generate
RUN npm run build

EXPOSE 3001

CMD ["npm", "run", "start:migrate"]
