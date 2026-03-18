# 🚀 Deploy en Producción con PM2 (Next.js Fullstack)

> **Arquitectura actual:** Admin + API + Webhooks + WS viven en **Next.js** (puerto 3002).  
> El **worker** corre jobs en un proceso separado (PM2).

## ✅ Pre-Deploy Checklist
- [x] Código en `main` y `git pull` aplicado
- [x] `.env` en root con secretos reales
- [x] Base de datos accesible
- [x] Prisma migrations listas

---

## 1) Requisitos
```bash
node -v   # >= 20
npm -v
```

Instalar PM2:
```bash
npm install -g pm2
```

---

## 2) Variables de Entorno (ROOT .env)
**Este archivo es fuente única** para admin + jobs.

```bash
# /srv/apiflujos/mdv/suscripciones/.env
NODE_ENV=production
PORT=3002
HOST=0.0.0.0

# DB
DATABASE_URL=postgresql://user:pass@host:5432/wompi_subs

# Auth (obligatorios)
ADMIN_API_TOKEN=token-seguro
ADMIN_SESSION_SECRET=secreto-sesion
JWT_SECRET=secreto-jwt
JWT_ISSUER=suscripciones
JWT_AUDIENCE=admin

# Encriptación (obligatorio)
CREDENTIALS_ENCRYPTION_KEY_B64=base64-32-bytes

# Super Admin (bootstrap)
SUPER_ADMIN_EMAIL=admin@tuempresa.com
SUPER_ADMIN_PASSWORD=Password-Seguro-123!
SUPER_ADMIN_RESET_PASSWORD=0

# Realtime (jobs -> admin)
REALTIME_PUBLISH_URL=https://tudominio.com/api/realtime/publish
REALTIME_PUBLISH_TOKEN=token-seguro

# Frontend
NEXT_PUBLIC_API_BASE_URL=https://tudominio.com
```

**Generar secretos:**
```bash
openssl rand -base64 32
```

---

## 3) Instalación + Build
```bash
cd /srv/apiflujos/mdv/suscripciones
npm install
npm run db:generate
npm run build -w apps/admin
```

---

## 4) Migraciones (Producción)
```bash
set -a
source /srv/apiflujos/mdv/suscripciones/.env
set +a
npm run prisma:migrate:deploy -w packages/database
```

---

## 5) PM2 Start
```bash
set -a
source /srv/apiflujos/mdv/suscripciones/.env
set +a
pm2 start ecosystem.config.js
pm2 save
```

Procesos esperados:
```
crm-sus-api-mdv   (Next.js)
crm-sus-jobs-mdv  (worker)
```

---

## 6) Nginx (Reverse Proxy)

```nginx
server {
  listen 80;
  server_name tudominio.com;
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name tudominio.com;

  ssl_certificate /etc/letsencrypt/live/tudominio.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/tudominio.com/privkey.pem;

  location /_next/ {
    proxy_pass http://127.0.0.1:3002;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location / {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

---

## 7) Health + Login
```bash
curl https://tudominio.com/health
curl https://tudominio.com/healthz
```

Login:
```
https://tudominio.com/login
https://tudominio.com/sa/login
```

---

## 8) Logs y Debug
```bash
pm2 status
pm2 logs crm-sus-api-mdv --lines 200
pm2 logs crm-sus-jobs-mdv --lines 200
```

---

## 9) Troubleshooting rápido
**Chunks 400/404:** limpiar CDN/cache y verificar `/ _next/static` pasa directo.  
**401 en /health:** revisar middleware (ya debe estar libre).  
**Jobs fallan:** revisar `DATABASE_URL` y `CREDENTIALS_ENCRYPTION_KEY_B64`.

