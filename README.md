# Wompi Subs - Plataforma de Suscripciones (Next.js Fullstack)

Plataforma de gestión de suscripciones y pagos con Wompi. **Frontend y backend están unificados en Next.js** (App Router) y un **worker** separado para jobs.

## 🏗️ Arquitectura (Actual)

```
┌──────────────────────────────┐
│          Next.js             │
│  UI + API + Webhooks + WS    │
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
│   ├── admin/                 ← Next.js (UI + API + Webhooks + WS)
│   │   ├── app/
│   │   │   ├── api/           ← API Routes
│   │   │   ├── webhooks/      ← Webhooks
│   │   │   └── ...            ← Páginas/Server Components
│   │   ├── lib/               ← JWT, RBAC, rate limit, WS hub
│   │   ├── middleware.ts
│   │   └── scripts/run-next.cjs ← Runner (HTTP + WS)
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

# 🚀 Producción con PM2 (Guía detallada)

## 1) Requisitos
- Node.js >= 20
- PostgreSQL accesible
- PM2 instalado

```bash
npm i -g pm2
```

## 2) Variables de entorno (obligatorias)
Crear `.env` en el root del repo:

```ini
DATABASE_URL=postgresql://USER:PASS@HOST:PORT/DB
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
```

> **Nota:** PM2 no exporta `.env` automáticamente al shell. Hay que cargarla antes de migrar y arrancar.

## 3) Instalación y build
```bash
cd /srv/apiflujos/mdv/suscripciones
npm install
npm run db:generate
npm run build -w apps/admin
```
> Importante: **no usar `npm install --omit=dev`** en producción. Next necesita TypeScript/typings para el build.

## 4) Migraciones en producción
**Usar siempre `migrate:deploy`:**

```bash
set -a
source .env
set +a
npm run prisma:migrate:deploy -w packages/database
```

## 5) Arranque con PM2 (óptimo)
Se usa **`.env` en el root** como fuente principal. El worker y el admin reciben `DATABASE_URL` y secrets explícitos.

Ejemplo de `ecosystem.config.js` (alineado con producción):

```js
module.exports = {
  apps: [
    {
      name: "crm-sus-api-mdv",
      cwd: "/srv/apiflujos/mdv/suscripciones/apps/admin",
      script: "node scripts/run-next.cjs start",
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

Luego:
```bash
set -a
source /srv/apiflujos/mdv/suscripciones/.env
set +a
pm2 start ecosystem.config.js
pm2 save
```

## 6) Proxy (Nginx)
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

## 7) Health check
```bash
curl -I http://localhost:3002/health
```

## 8) Realtime (WebSocket)
- WS endpoint: `ws://<host>:3002/ws`
- Autenticación: `Authorization: Bearer <JWT>` o `?token=JWT`

Ejemplo:
```js
const ws = new WebSocket("wss://mdv.sus.apiflujos.com/ws?token=JWT");
ws.onopen = () => ws.send(JSON.stringify({ action: "subscribe", channel: "payments" }));
```

---

## 🛠️ Stack
- Next.js 15 (App Router)
- React 19
- Prisma
- PostgreSQL
- WS (ws)

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
