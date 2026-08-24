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
# El build de Next corre con NEXT_DISABLE_TYPESCRIPT=1, así que sin esto un
# error de tipos llega a producción sin que nadie lo vea.
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
JOBS_NAME="${PM2_APP_PREFIX:-crm-sus}-jobs${CLIENT_SLUG:+-$CLIENT_SLUG}"
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
