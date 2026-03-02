# Suscripciones (Wompi + Chatwoot) – Base (Producción)

El repo remoto `apiflujos/suscripciones` estaba **vacío (sin commits)**. Este proyecto inicializa una base con estándares de producción para construir el sistema completo de suscripciones.

## Stack

- **API**: Node.js + TypeScript + Express + Prisma + PostgreSQL
- **Admin**: Next.js (panel mínimo, autenticación por sesión)
- **Un solo webhook Wompi**: validación de firma + idempotencia + procesamiento asíncrono
- **Jobs/reintentos**: tabla `retry_jobs` + runner (sin Redis)
- **Deploy**: Render Blueprint (`render.yaml`)

## Restricción crítica: 1 webhook de Wompi

Se implementa **webhook central propio** (Wompi → nuestro backend) y desde ahí se enruta:

- **Suscripciones**: procesamiento interno
- **Shopify**: reenvío HTTP opcional (configurable) cuando la referencia pertenece a Shopify

Razones:

- Control total de **idempotencia**, reintentos, auditoría y trazabilidad.
- Permite bifurcar flujos sin depender de disponibilidad de Shopify.
- Responde rápido a Wompi y procesa en background (tolerancia a fallos).

## Flujo del webhook (Wompi)

1. `POST /webhooks/wompi` recibe evento
2. **Valida firma** usando `WOMPI_EVENTS_SECRET` y el checksum (`X-Event-Checksum` o `signature.checksum`)
3. Inserta en `webhook_events` con `checksum` **único** (idempotencia)
4. Encola `retry_jobs(type=PROCESS_WOMPI_EVENT)`
5. `npm run jobs` procesa el evento:
   - Si `reference` indica Shopify → encola `FORWARD_WOMPI_TO_SHOPIFY`
   - Si `reference` indica suscripción → registra/actualiza `payments` (base)

Clasificación actual por prefijo:

- `SUB_<subscriptionId>_<cycle?>`
- `SHOPIFY_<...>`

## Estructura

- `apps/api`: backend + Prisma + jobs + webhook Wompi (también sirve el Admin)
- `apps/admin`: panel administrativo (Next.js)

## Setup local

Requisitos: Node 20+, Docker.

1. Instalar dependencias del monorepo:

```bash
npm install
```

2. Levantar PostgreSQL:

```bash
docker-compose up -d
```

3. Variables de entorno:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/admin/.env.example apps/admin/.env.local
```

4. Migraciones (primera vez) + correr API:

```bash
npm -w apps/api run prisma:migrate:dev
npm -w apps/api run dev
```

5. (Opcional) correr jobs:

```bash
npm -w apps/api run jobs
```

6. Admin:

```bash
npm -w apps/admin run dev
```

## Variables de entorno (API)

Ver `apps/api/.env.example`.

Obligatorias (para arrancar):

- `SUPER_ADMIN_EMAIL` y `SUPER_ADMIN_PASSWORD` (crea el usuario SUPER_ADMIN automáticamente si no existe)
- `SUPER_ADMIN_RESET_PASSWORD=1` (opcional, fuerza reset de contraseña en cada arranque)

Credenciales (pueden ir por **ENV** o guardarse desde el Admin en `/settings`):

- `WOMPI_EVENTS_SECRET` (secreto de eventos/webhooks)
- `WOMPI_PRIVATE_KEY` (para crear payment links)

Para guardar credenciales en DB (recomendado):

- `CREDENTIALS_ENCRYPTION_KEY_B64` (Base64 de 32 bytes; cifra secretos en `credentials`)

Wompi API (defaults OK):

- `WOMPI_API_BASE_URL` (ej. `https://sandbox.wompi.co/v1`)
- `WOMPI_CHECKOUT_LINK_BASE_URL` (default: `https://checkout.wompi.co/l/`)
- `WOMPI_REDIRECT_URL` (opcional)
- `WOMPI_ACTIVE_ENV` (`PRODUCTION` | `SANDBOX`)

Opcionales (ENV o `/settings`):

- `SHOPIFY_FORWARD_URL` (URL para forward de eventos Wompi cuando aplique)
- `SHOPIFY_FORWARD_SECRET` (secreto compartido opcional para forward)
- `SHOPIFY_FORWARD_ORIGIN` (`shopify` | `shopify-native`)
- `SHOPIFY_FORWARD_RETRY_ENABLED` (default `true`)
- `SHOPIFY_FORWARD_RETRY_MINUTES` (default `15`)
- `CHATWOOT_*` (si quieres notificaciones en Chatwoot)
- `CHATWOOT_ACTIVE_ENV` (`PRODUCTION` | `SANDBOX`)
- `APP_HOST` (URL pública del API, opcional)

## Variables de entorno (Admin)

Ver `apps/admin/.env.example`.

## Configuración única con `.env.example` (producción/PM2)

Esta base está preparada para **un solo dominio y un solo puerto público**. El Admin se sirve desde el mismo servidor del API.
La configuración se centraliza en el `.env.example` de la **raíz**.

### Pasos recomendados

1. Copia la plantilla y completa valores reales:
   - `DATABASE_URL`
   - `ADMIN_API_TOKEN` (debe ser **el mismo** en API y Admin)
   - `ADMIN_SESSION_SECRET`
   - `SUPER_ADMIN_EMAIL` y `SUPER_ADMIN_PASSWORD` (crea el SUPER_ADMIN automáticamente al arrancar)
   - `NEXT_PUBLIC_API_BASE_URL` = **tu dominio público** (ej. `https://tu-dominio.com`)
   - Credenciales Wompi/Chatwoot si aplica

2. Duplica el contenido en los archivos reales:
   - `apps/api/.env`
   - `apps/admin/.env.local`

3. Build + PM2:
   ```bash
   npm run build --workspaces
   pm2 start ecosystem.config.js
   ```

### Notas importantes

- `NEXT_PUBLIC_API_BASE_URL` **no debe** apuntar a `localhost` en producción.
- El SUPER_ADMIN se crea **automáticamente** si no existe.
  - Si quieres forzar reset de contraseña en cada arranque, usa `SUPER_ADMIN_RESET_PASSWORD=1`.
- Define tus propias credenciales en variables de entorno. **No uses valores reales en el repositorio**.
- Con un solo dominio no necesitas puertos separados para Admin.

## API Docs (mínimo)

Ver `docs/API.md`.

- `NEXT_PUBLIC_API_BASE_URL` (ej. `http://localhost:3001` en local, o `https://tu-dominio.com` si el Admin corre en el mismo servidor)
- `ADMIN_INTERNAL_API_BASE_URL` (opcional, override interno)
- `ADMIN_API_TOKEN` (el mismo valor que el `ADMIN_API_TOKEN` del API)
- `ADMIN_API_TOKEN` se usa para autenticar la API desde el Admin (login y acciones internas)

## Endpoints

- `POST /webhooks/wompi` webhook central (firma + idempotencia + enqueue)
- `GET /health` health check
- `GET /admin/webhook-events` (requiere `Authorization: Bearer $ADMIN_API_TOKEN`)
- `GET/POST /admin/plans` CRUD base
- `GET/POST /admin/customers` CRUD base
- `GET/POST /admin/subscriptions` CRUD base
- `POST /admin/subscriptions/:id/payment-link` crea `payment` + crea Wompi payment link + retorna `checkoutUrl`

## Quickstart (API)

Headers:

```bash
export API_BASE=http://localhost:3001
export API_TOKEN=change-me-change-me
```

Crear plan:

```bash
curl -sS "$API_BASE/admin/plans" -H "authorization: Bearer $API_TOKEN" -H "content-type: application/json" -d '{"name":"Plan Mensual","priceInCents":49000,"currency":"COP","intervalUnit":"MONTH","intervalCount":1}' | jq
```

## Deploy en Render

- Blueprint: `render.yaml` crea Postgres + servicios (API + Jobs + Admin).
- También crea un **Worker** `wompi-subs-jobs` (necesario) para procesar colas: forward a Shopify, mensajes Chatwoot, y procesamiento asíncrono del webhook.
- La API arranca con `prisma migrate deploy` (migraciones automáticas en deploy).
- El Worker arranca con `prisma migrate deploy` antes de procesar jobs (evita fallas si el worker inicia primero).

Si no usas Blueprint (servicios creados manualmente en Render), usa estos comandos:

- **API**
  - Build: `npm ci && npm -w apps/api run build`
  - Start: `npm -w apps/api run start:migrate` (o `npm run start:migrate`)

## Despliegue con PM2 (VPS / Linux)

Para desplegar en un servidor propio usando PM2, sigue estos pasos:

1. **Build completo**:

   ```bash
   npm install
   npm run build --workspaces
   ```

2. **Variables de entorno**:
   Copia los archivos `.env` en `apps/api/.env` y `apps/admin/.env.local` con tus credenciales de producción.

3. **Arrancar con PM2**:
   Usa el archivo `ecosystem.config.js` incluido en la raíz:
   ```bash
   pm2 start ecosystem.config.js
   ```

Este comando arrancará 2 procesos:

- `wompi-subs-api`: La API principal, el servidor de webhooks y el Admin (Next.js).
- `wompi-subs-jobs`: El procesador de tareas en segundo plano.

**Comandos útiles de PM2:**

- Ver estado: `pm2 status`
- Ver logs: `pm2 logs`
- Reiniciar todo: `pm2 restart ecosystem.config.js`
- Detener todo: `pm2 stop ecosystem.config.js`
