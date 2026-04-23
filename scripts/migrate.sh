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

echo "🔄 Ejecutando migraciones de base de datos..."
echo "🗄️ Generando Prisma Client..."
npm run db:generate

echo "🔄 Aplicando migraciones..."
npm run prisma:migrate:deploy -w packages/database

if [ "${1:-}" = "--seed" ]; then
  echo "🌱 Ejecutando seed bootstrap seguro..."
  npx prisma db seed --schema ./packages/database/prisma/schema.prisma
fi

echo "✅ Migraciones completadas"
