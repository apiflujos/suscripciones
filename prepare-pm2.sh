#!/bin/bash
# Script para preparar el despliegue STANDALONE para PM2

echo "📦 Instalando dependencias..."
npm install

echo "🏗️ Construyendo aplicaciones..."
npm run build --workspaces

echo "✅ Listo. Puedes arrancar con: pm2 start ecosystem.config.js"
