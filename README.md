# Suscripciones (Wompi + Chatwoot) – Base (Producción)

El repo remoto `apiflujos/suscripciones` estaba **vacío (sin commits)**. Este proyecto inicializa una base con estándares de producción para construir el sistema completo de suscripciones.

## Stack

- **API**: Node.js + TypeScript + Express + Prisma + PostgreSQL
- **Admin**: Next.js (panel mínimo, protegido con Basic Auth)
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

- `apps/api`: backend + Prisma + jobs + webhook Wompi
- `apps/admin`: panel administrativo (Next.js)

## Setup local

Requisitos: Node 20+, Docker.

1) Instalar dependencias del monorepo:

```bash
npm install
```

2) Levantar PostgreSQL:

```bash
docker-compose up -d
```

3) Variables de entorno:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/admin/.env.example apps/admin/.env.local
```

4) Migraciones (primera vez) + correr API:

```bash
npm -w apps/api run prisma:migrate:dev
npm -w apps/api run dev
```

5) (Opcional) correr jobs:

```bash
npm -w apps/api run jobs
```

6) Admin:

```bash
npm -w apps/admin run dev
```

## Variables de entorno (API)

Ver `apps/api/.env.example`.

Obligatorias (para arrancar):

- `DATABASE_URL`
- `ADMIN_API_TOKEN` (para endpoints admin del API)

Credenciales (pueden ir por **ENV** o guardarse desde el Admin en `/settings`):

- `WOMPI_EVENTS_SECRET` (secreto de eventos/webhooks)
- `WOMPI_PRIVATE_KEY` (para crear payment links)

Para guardar credenciales en DB (recomendado):

- `CREDENTIALS_ENCRYPTION_KEY_B64` (Base64 de 32 bytes; cifra secretos en `credentials`)

Wompi API (defaults OK):

- `WOMPI_API_BASE_URL` (ej. `https://sandbox.wompi.co/v1`)
- `WOMPI_CHECKOUT_LINK_BASE_URL` (default: `https://checkout.wompi.co/l/`)
- `WOMPI_REDIRECT_URL` (opcional)

Opcionales (ENV o `/settings`):

- `SHOPIFY_FORWARD_URL` (URL para forward de eventos Wompi cuando aplique)
- `SHOPIFY_FORWARD_SECRET` (secreto compartido opcional para forward)
- `CHATWOOT_*` (si quieres notificaciones en Chatwoot)

## Variables de entorno (Admin)

Ver `apps/admin/.env.example`.

- `NEXT_PUBLIC_API_BASE_URL` (ej. `http://localhost:3001`)
- `API_ADMIN_TOKEN` (debe ser el mismo que `ADMIN_API_TOKEN` del API)
- `ADMIN_BASIC_USER`, `ADMIN_BASIC_PASS` (si están seteadas, el panel pide Basic Auth)

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

- Blueprint: `render.yaml` crea Postgres + 2 servicios (API + Admin).
- La API arranca con `prisma migrate deploy` (migraciones automáticas en deploy).
