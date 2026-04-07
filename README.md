# Wompi Subs - Plataforma de Suscripciones (Next.js Fullstack)

Plataforma de gestión de suscripciones y pagos con Wompi. **Frontend y backend están unificados en Next.js** (App Router), con **SSE + fallback a polling** para realtime y un **worker** separado para jobs.

## 🏗️ Arquitectura (Actual)

```
┌──────────────────────────────┐
│          Next.js             │
│ UI + API + Webhooks + SSE    │
│           :3002              │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│         PostgreSQL           │
│            :5432             │
└──────────────────────────────┘
               ▲
               │
┌──────────────────────────────┐
│            Worker            │
│   Jobs / Retry / Scheduler    │
└──────────────────────────────┘
```

## 📁 Estructura

```
wompi_subs/
├── apps/
│   ├── admin/                 ← Next.js (UI + API + Webhooks + SSE)
│   │   ├── app/
│   │   │   ├── api/           ← API Routes
│   │   │   ├── webhooks/      ← Webhooks
│   │   │   └── ...            ← Páginas/Server Components
│   │   ├── lib/               ← JWT, RBAC, rate limit, realtime hub
│   │   ├── middleware.ts
│   └── worker/                ← Jobs (Retry, scheduler, etc)
│       └── src/runner.ts
│
├── packages/
│   ├── core/                  ← Servicios y lógica de negocio
│   └── database/              ← Prisma schema + client
│
├── docker-compose.yml
├── ecosystem.config.js
└── package.json
```

## ✅ Comandos Disponibles

```bash
# Desarrollo
npm run dev:admin      # Next.js

# Build
npm run build          # Next.js
npm run build:admin

# Jobs
npm run jobs           # Worker jobs

# Base de datos
npm run db:generate    # Prisma generate
npm run db:migrate     # Migraciones (dev)
```

---

# 🧪 Local (Docker + Seed)

Esta guía es **solo para local**. El seed NO se usa en producción.

```bash
cp .env.example .env
docker compose up -d
docker exec -it -w /app wompi-admin npm -w packages/database run prisma:migrate:deploy
docker exec -it -w /app wompi-admin node scripts/seed_local.js
```

URLs:
- Admin: http://localhost:3002/login
- Super Admin: http://localhost:3002/sa/login

---

# 🚀 Producción con PM2 (Guía operativa)

## 1) Requisitos
- Node.js >= 20
- PostgreSQL accesible
- PM2 instalado

```bash
npm i -g pm2
```

## 2) Variables de entorno (obligatorias)
Crear `.env` en el root del repo. **Este archivo es fuente única** para admin + jobs + migraciones + build.

```ini
DATABASE_URL=postgresql://USER:PASS@HOST:PORT/DB
HOST=0.0.0.0
PORT=3002
PM2_APP_PREFIX=crm-sus
CLIENT_SLUG=mdv
JWT_SECRET=... (min 32 bytes)
JWT_ISSUER=suscripciones
JWT_AUDIENCE=admin
ADMIN_SESSION_SECRET=... (min 32 bytes)
CREDENTIALS_ENCRYPTION_KEY_B64=... (32 bytes base64)
SUPER_ADMIN_EMAIL=...
SUPER_ADMIN_PASSWORD=...
WOMPI_PUBLIC_KEY=...
WOMPI_PRIVATE_KEY=...
WOMPI_API_BASE_URL=https://api.wompi.co/v1
NEXT_PUBLIC_API_BASE_URL=https://mdv.sus.apiflujos.com
NEXT_PUBLIC_PUBLIC_BASE_URL=https://mdv.sus.apiflujos.com
```

> No uses `apps/admin/.env.local` en producción. `ecosystem.config.js` ya consume `.env` del root.

## 3) Precheck antes del deploy
```bash
cd /srv/apiflujos/mdv/suscripciones
test -f .env
set -a
source .env
set +a
echo "$DATABASE_URL" | sed 's#://.*@#://***:***@#'
node -v
pm2 -v
```

Si esta release incluye cambios estructurales en Prisma, respalda la base antes de seguir:

```bash
pg_dump "$DATABASE_URL" > "backup-$(date +%F-%H%M%S).sql"
```

## 4) Instalación y build
```bash
cd /srv/apiflujos/mdv/suscripciones
npm ci
npm run db:generate
npm run build -w apps/admin
```
> Importante: no usar `npm install --omit=dev`. El build de Next necesita toolchain completa.

## 5) Migraciones en producción
Usar siempre `migrate:deploy`:

```bash
set -a
source .env
set +a
npm run prisma:migrate:deploy -w packages/database
```

### Migración de billing actual
Esta versión elimina `currentCycle`, `currentPeriodStartAt` y `currentPeriodEndAt` de `Subscription`.

Orden correcto:
1. build
2. `migrate:deploy`
3. restart PM2

No reinicies PM2 antes de aplicar la migración.

## 6) Arranque con PM2
Se usa `.env` en el root como fuente principal. El worker y el admin reciben `DATABASE_URL` y secrets explícitos.

Ejemplo de `ecosystem.config.js` (alineado con producción):

```js
module.exports = {
  apps: [
    {
      name: "crm-sus-admin-mdv",
      cwd: "/srv/apiflujos/mdv/suscripciones/apps/admin",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        PORT: 3002,
        HOST: "0.0.0.0",
        DATABASE_URL: process.env.DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_ISSUER: process.env.JWT_ISSUER,
        JWT_AUDIENCE: process.env.JWT_AUDIENCE,
        ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
        CREDENTIALS_ENCRYPTION_KEY_B64: process.env.CREDENTIALS_ENCRYPTION_KEY_B64,
        REALTIME_PUBLISH_URL: process.env.REALTIME_PUBLISH_URL,
        REALTIME_PUBLISH_TOKEN: process.env.REALTIME_PUBLISH_TOKEN
      }
    },
    {
      name: "crm-sus-jobs-mdv",
      cwd: "/srv/apiflujos/mdv/suscripciones/apps/worker",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: process.env.DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_ISSUER: process.env.JWT_ISSUER,
        JWT_AUDIENCE: process.env.JWT_AUDIENCE,
        CREDENTIALS_ENCRYPTION_KEY_B64: process.env.CREDENTIALS_ENCRYPTION_KEY_B64,
        REALTIME_PUBLISH_URL: process.env.REALTIME_PUBLISH_URL,
        REALTIME_PUBLISH_TOKEN: process.env.REALTIME_PUBLISH_TOKEN
      }
    }
  ]
};
```

Primer arranque:
```bash
set -a
source /srv/apiflujos/mdv/suscripciones/.env
set +a
pm2 start ecosystem.config.js
pm2 save
```

Deploy/reload normal:
```bash
cd /srv/apiflujos/mdv/suscripciones
set -a
source .env
set +a
git pull --ff-only
npm ci
npm run db:generate
npm run prisma:migrate:deploy -w packages/database
npm run build -w apps/admin
pm2 restart ecosystem.config.js --update-env
```

Con script:
```bash
./scripts/deploy.sh
```

Solo migración:
```bash
./scripts/migrate.sh
```

## 7) Validación post-deploy
```bash
curl -I http://127.0.0.1:3002/health
pm2 status
pm2 logs crm-sus-admin-mdv --lines 100
pm2 logs crm-sus-jobs-mdv --lines 100
```

Checklist funcional mínimo:
- abrir `/billing`
- abrir modal de ciclos
- confirmar que una suscripción muestra ciclos pasados y actual
- crear o asociar un pago
- verificar que el worker sigue levantando jobs

Verificación SQL recomendada después de esta migración:
```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'Subscription'
  AND column_name IN ('currentCycle', 'currentPeriodStartAt', 'currentPeriodEndAt');
```

Debe devolver `0` filas.

## 8) URLs clave
- Login Admin: `/login`
- Login Super Admin: `/sa/login`
- Health público: `/health` y `/healthz`

Ejemplo:
```
https://mdv.sus.apiflujos.com/login
```

## 9) Proxy (Nginx)
Asegura que `/_next` **no** pase por auth y no se bloquee:

```nginx
location /_next/ {
  proxy_pass http://127.0.0.1:3002;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location / {
  proxy_pass http://127.0.0.1:3002;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## 10) Health check
```bash
curl -I http://localhost:3002/health
```

## 11) Realtime (SSE + fallback)
- Endpoint SSE: `/api/realtime?channel=<canal>`
- Canales soportados: `notifications`, `payments`, `logs`, `jobs`
- El cliente del admin usa `EventSource` y cae a polling si el stream falla

## 12) Troubleshooting
- **401 en /health:** revisar middleware. `/health` debe ser público.
- **Chunks 400/404:** limpiar CDN/cache y verificar `_next/static` directo.
- **Jobs fallan:** verificar `DATABASE_URL`, `CREDENTIALS_ENCRYPTION_KEY_B64` y que no exista `.env.local` dentro de `apps/admin`.
- **Falla `migrate:deploy`:** confirmar `DATABASE_URL` cargado con `set -a && source .env && set +a`.
- **PM2 sigue con env vieja:** usar `pm2 restart ecosystem.config.js --update-env`.
- **Error por columnas legacy faltantes:** confirma que el código desplegado y la migración corresponden a la misma release.

## 13) Comandos útiles PM2
```bash
pm2 status
pm2 logs crm-sus-admin-mdv --lines 200
pm2 logs crm-sus-jobs-mdv --lines 200
pm2 restart crm-sus-admin-mdv
pm2 restart crm-sus-jobs-mdv
pm2 restart ecosystem.config.js --update-env
pm2 save
```

---

## 🛠️ Stack
- Next.js 15 (App Router)
- React 19
- Prisma
- PostgreSQL
- SSE + polling fallback

---

## 🔐 Seguridad
- JWT obligatorio (Authorization / X-Auth-Token)
- RBAC por ruta/método
- Rate limit (Upstash opcional)
- Security headers (CSP, HSTS, etc.)
- Webhooks protegidos
- Media protegida por tokens firmados

---

## 🧩 Notas de despliegue
- Si los chunks devuelven 400/404, es cache/CDN o proxy. Purga CDN y valida `_next/static` directo.
- PM2 requiere que la shell cargue `.env` antes de arrancar.
