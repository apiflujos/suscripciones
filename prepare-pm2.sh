#!/bin/bash
set -euo pipefail
# Script para preparar el despliegue STANDALONE para PM2

echo "📦 Instalando dependencias..."
# --include=dev: el build necesita typescript aunque NODE_ENV=production
npm ci --include=dev
npm run db:generate

echo "🏗️ Construyendo aplicaciones..."
npm run build -w apps/admin

echo "✅ Listo. Puedes arrancar con: pm2 start ecosystem.config.js"
