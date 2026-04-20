#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f ".env" ]; then
  echo "❌ Falta .env en $ROOT_DIR"
  exit 1
fi

set -a
source ./.env
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DATABASE_URL no está definido en .env"
  exit 1
fi

echo "🚀 Iniciando deploy en $ROOT_DIR"

echo "📦 Obteniendo últimos cambios..."
git pull --ff-only

echo "📦 Instalando dependencias..."
npm ci

echo "🗄️ Generando Prisma Client..."
npm run db:generate

echo "🔄 Aplicando migraciones..."
npm run prisma:migrate:deploy -w packages/database

echo "🔨 Construyendo aplicación..."
npm run build -w apps/admin

echo "🔄 Recargando PM2..."
pm2 restart ecosystem.config.js --update-env 2>/dev/null || pm2 start ecosystem.config.js --update-env
pm2 save

echo "✅ Verificando servicios..."
sleep 5
pm2 status
curl -fsS "http://127.0.0.1:${PORT:-3002}/health" >/dev/null

echo "🎉 Deploy completado"
