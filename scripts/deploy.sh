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
# --include=dev es obligatorio, no una preferencia. Este script hace `source .env`
# unas líneas más arriba, y ahí vive NODE_ENV=production: npm lo respeta y omite
# las dependencias de desarrollo. Sin ellas no hay typescript, así que el
# typecheck muere con "tsc: not found" y el build de Next moriría dos líneas
# después. Es la razón por la que este script nunca llegó a correr entero y las
# migraciones se acabaron aplicando a mano.
npm ci --include=dev

echo "🗄️ Generando Prisma Client..."
npm run db:generate

# Sin cliente generado, `@prisma/client` no exporta nada y el typecheck se llena
# de "has no exported member 'LogLevel'" — decenas de errores que no dicen cuál
# es la causa. Se comprueba aquí, donde sí se puede explicar.
if ! node -e "const c=require('@prisma/client'); if(!c.LogLevel) process.exit(1)" 2>/dev/null; then
  echo "❌ El cliente de Prisma no quedó generado."
  echo "   Sin él nada compila. Ejecutar: npm run db:generate"
  exit 1
fi
echo "   cliente de Prisma: ok"

echo "💾 Respaldando la base antes de migrar..."
if command -v pg_dump >/dev/null 2>&1; then
  BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"
  if pg_dump "$DATABASE_URL" 2>/dev/null | gzip > "$BACKUP_FILE"; then
    echo "   respaldo en $BACKUP_FILE"
  else
    rm -f "$BACKUP_FILE"
    echo "   ⚠️  no se pudo respaldar; se sigue igual"
  fi
else
  echo "   ⚠️  pg_dump no está instalado: se despliega sin respaldo"
fi

echo "🔎 Verificando tipos..."
# El build de Next corre con typescript.ignoreBuildErrors, así que sin este paso
# un error de tipos llega a producción sin que nadie lo vea.
# El pretypecheck del workspace de admin borra apps/admin/.next/types antes de
# tsc para que los validators de rutas eliminadas en un deploy anterior no
# hagan caer este paso —el que tenía que atrapar los tipos reales— con errores
# TS2307 sobre módulos que ya no existen.
npm run typecheck

echo "🔄 Aplicando migraciones..."
npm run prisma:migrate:deploy -w packages/database

echo "🔨 Construyendo aplicación..."
npm run build -w apps/admin
npm run build -w apps/worker
echo "🔄 Recargando PM2..."
pm2 restart ecosystem.config.js --update-env 2>/dev/null || pm2 start ecosystem.config.js --update-env
pm2 save

echo "✅ Verificando servicios..."
sleep 5
pm2 status
curl -fsS "http://127.0.0.1:${PORT:-3002}/health" >/dev/null

# El proceso de jobs es el que cobra. Si queda caído, el deploy no falla solo
# —el admin responde igual— y nadie se entera hasta que no se cobra nada.
# El nombre se lee de ecosystem.config.js, que es quien de verdad lo decide.
# Reconstruirlo aquí a mano ya ignoraba APP_STACK_NAME: si alguien lo usara en
# vez de PM2_APP_PREFIX, este chequeo buscaría un proceso que no existe y el
# deploy fallaría al final con la cobranza perfectamente sana.
JOBS_NAME="$(node -e "
  const apps = require('./ecosystem.config.js').apps || [];
  const jobs = apps.find((a) => /-jobs(-|\$)/.test(a.name));
  if (!jobs) { process.exit(1); }
  process.stdout.write(jobs.name);
")" || {
  echo "❌ No se pudo leer el nombre del proceso de jobs de ecosystem.config.js"
  exit 1
}
JOBS_STATUS="$(pm2 jlist 2>/dev/null | node -e "
  let raw = '';
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    try {
      const app = JSON.parse(raw).find((a) => a.name === process.argv[1]);
      process.stdout.write(app ? String(app.pm2_env.status) : 'ausente');
    } catch {
      process.stdout.write('desconocido');
    }
  });
" "$JOBS_NAME")"

if [ "$JOBS_STATUS" != "online" ]; then
  echo "❌ El proceso de jobs ($JOBS_NAME) está '$JOBS_STATUS', no 'online'."
  echo "   Sin él no se cobra ni se envían avisos: pm2 logs $JOBS_NAME --lines 50"
  exit 1
fi
echo "   jobs ($JOBS_NAME): online"

# La rotación es un módulo aparte de PM2 y se instala una sola vez por servidor.
# Sin ella los logs crecen sin techo, que es el otro extremo de no tener ninguno.
if ! pm2 list 2>/dev/null | grep -q "pm2-logrotate"; then
  echo "⚠️  pm2-logrotate no está instalado: los logs van a crecer sin límite."
  echo "   Instalarlo una vez con: pm2 install pm2-logrotate"
fi

echo "📊 Estado de la cobranza:"
npm run check:jobs || echo "   (no se pudo leer; revisar con: npm run check:jobs)"

echo "🎉 Deploy completado"
