#!/bin/bash

# ========================================
# Script de Deploy - Suscripciones API
# ========================================

set -e  # Exit on error

echo "🚀 Iniciando deploy..."

# 1. Pull de últimos cambios
echo "📦 Obteniendo últimos cambios..."
git pull origin main

# 2. Instalar dependencias
echo "📦 Instalando dependencias..."
npm ci --production

# 3. Generar Prisma Client
echo "🗄️  Generando Prisma Client..."
npx prisma generate --schema ./packages/database/prisma/schema.prisma

# 4. Ejecutar migraciones
echo "🔄 Ejecutando migraciones..."
npx prisma migrate deploy --schema ./packages/database/prisma/schema.prisma

# 5. Build del proyecto
echo "🔨 Construyendo aplicación..."
npm run build

# 6. Reiniciar PM2
echo "🔄 Reiniciando PM2..."
pm2 restart ecosystem.config.js --update-env

# 7. Verificar servicios
echo "✅ Verificando servicios..."
sleep 5
pm2 status

echo "🎉 Deploy completado exitosamente!"
