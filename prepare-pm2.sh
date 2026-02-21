#!/bin/bash
# Script para preparar el despliegue STANDALONE para PM2

echo "📦 Instalando dependencias..."
npm install

echo "🏗️ Construyendo aplicaciones..."
npm run build --workspaces

echo "📁 Preparando archivos para Standalone Admin..."
# Next.js Standalone no incluye public ni static por defecto en el servidor node.
# Los copiamos para que PM2 pueda servirlos sin necesidad de Nginx configurado a mano.
cp -r apps/admin/public apps/admin/.next/standalone/apps/admin/
cp -r apps/admin/.next/static apps/admin/.next/standalone/apps/admin/.next/

echo "✅ Listo. Puedes arrancar con: pm2 start ecosystem.config.js"
