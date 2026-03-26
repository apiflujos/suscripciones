#!/bin/bash

# ========================================
# Script de Migración de Base de Datos
# ========================================

set -e  # Exit on error

echo "🔄 Ejecutando migraciones de base de datos..."

# 1. Generar Prisma Client
echo "🗄️  Generando Prisma Client..."
npx prisma generate --schema ./packages/database/prisma/schema.prisma

# 2. Ejecutar migraciones
echo "🔄 Aplicando migraciones..."
npx prisma migrate deploy --schema ./packages/database/prisma/schema.prisma

# 3. Hacer seed (opcional)
if [ "$1" == "--seed" ]; then
  echo "🌱 Ejecutando seed..."
  npx prisma db seed --schema ./packages/database/prisma/schema.prisma
fi

echo "✅ Migraciones completadas!"
