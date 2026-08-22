# 🚀 Guía de Deploy - Suscripciones

## 📋 Requisitos Previos

- Node.js 20+
- PostgreSQL 16+
- PM2 instalado globalmente (`npm install -g pm2`)
- Acceso al servidor de producción

---

## 🔧 Configuración Inicial

### 1. Variables de Entorno

Crear archivo `.env` en la raíz del proyecto:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/suscripciones_db"

# JWT
JWT_SECRET="tu-secreto-jwt"
JWT_ISSUER="suscripciones-api"
JWT_AUDIENCE="suscripciones-admin"

# Encryption
CREDENTIALS_ENCRYPTION_KEY_B64="clave-encripcion-base64"

# Wompi
WOMPI_PRIVATE_KEY="wompi_private_key"
WOMPI_PUBLIC_KEY="wompi_public_key"
WOMPI_INTEGRITY_SECRET="wompi_integrity_secret"

# Chatwoot / WhatsApp
CHATWOOT_ACCESS_TOKEN="chatwoot_token"
CHATWOOT_INBOX_ID="inbox_id"
CHATWOOT_API_URL="https://chatwoot-url.com"

# Realtime
REALTIME_PUBLISH_URL="http://localhost:3000"
REALTIME_PUBLISH_TOKEN="realtime_token"

# Ports
PORT=3002
```

### 2. Instalar Dependencias

```bash
npm ci
```

### 3. Generar Prisma Client

```bash
npx prisma generate --schema ./packages/database/prisma/schema.prisma
```

---

## ✅ Qué verifica el deploy

`scripts/deploy.sh` no solo publica: además

1. **Respalda la base** antes de migrar (si hay `pg_dump`), en `backups/`.
2. **Verifica tipos** antes de construir. El build de Next corre con
   `NEXT_DISABLE_TYPESCRIPT=1`, así que sin este paso un error de tipos llega
   a producción sin que nadie lo vea.
3. **Comprueba que el proceso de jobs quedó `online`**, no solo el admin. Es el
   que cobra y el que envía los avisos; si queda caído, el admin responde
   igual y no se nota hasta que deja de entrar plata.
4. **Muestra el estado de la cobranza** al terminar (`npm run check:jobs`):
   qué se movió hoy, qué está agendado y qué quedó atrasado sin que nadie lo
   tome.

Si el paso 3 falla, el deploy termina con error: es preferible enterarse ahí
que descubrirlo por los cobros que no salieron.

## 📦 Deploy con Scripts

### Deploy Completo

```bash
./scripts/deploy.sh
```

Este script:
1. ✅ Pull de últimos cambios
2. ✅ Instala dependencias
3. ✅ Genera Prisma Client
4. ✅ Ejecuta migraciones
5. ✅ Construye la aplicación
6. ✅ Reinicia PM2

### Solo Migraciones

```bash
./scripts/migrate.sh
```

### Migraciones + Seed

```bash
./scripts/migrate.sh --seed
```

`--seed` ejecuta solo el bootstrap seguro de producción: tenant default, backfills de `tenantId` y join tables. No carga demo data.

---

## 🔁 Deploy Manual

### 1. Build

```bash
npm run build
```

### 2. Migraciones

```bash
npx prisma migrate deploy --schema ./packages/database/prisma/schema.prisma
```

### 3. Iniciar con PM2

```bash
# Iniciar todos los servicios
pm2 start ecosystem.config.js

# O reiniciar si ya existen
pm2 restart ecosystem.config.js --update-env
```

### 4. Verificar

```bash
# Ver estado de servicios
pm2 status

# Ver logs
pm2 logs crm-sus-admin --lines 50
pm2 logs crm-sus-jobs --lines 50

# Ver detalles de un servicio
pm2 show crm-sus-admin
```

---

## 📊 Servicios PM2

El `ecosystem.config.js` configura 2 servicios:

| Servicio | Puerto | Función |
|----------|--------|---------|
| `crm-sus-admin` | 3002 | Next.js (UI + API + Webhooks) |
| `crm-sus-jobs` | - | Background Jobs |

---

## 🔍 Comandos Útiles

### Logs

```bash
# Ver todos los logs
pm2 logs

# Ver logs de un servicio específico
pm2 logs crm-sus-admin

# Ver logs en tiempo real
pm2 logs --lines 100

# Limpiar logs
pm2 flush
```

### Reiniciar Servicios

```bash
# Reiniciar todos
pm2 restart all

# Reiniciar servicio específico
pm2 restart crm-sus-admin

# Reiniciar con variables de entorno actualizadas
pm2 restart ecosystem.config.js --update-env
```

### Detener Servicios

```bash
# Detener todos
pm2 stop all

# Detener servicio específico
pm2 stop crm-sus-admin
```

### Monitoreo

```bash
# Ver estado
pm2 status

# Ver detalles
pm2 show crm-sus-admin

# Monitoreo en tiempo real
pm2 monit
```

---

## 🗄️ Base de Datos

### Crear Migración

```bash
npx prisma migrate dev --name descripcion_del_cambio
```

### Aplicar Migraciones en Producción

```bash
npx prisma migrate deploy
```

### Migración de Ciclos de Facturación (Importante)

Si vienes de una versión anterior a los ciclos de facturación como source of truth:

```bash
# 1. Aplicar migraciones de schema primero
npx prisma migrate deploy --schema ./packages/database/prisma/schema.prisma

# 2. Ejecutar backfill para generar ciclos en suscripciones existentes
npx tsx packages/core/src/scripts/backfill-billing-cycles.ts

# 3. Verificar que no queden suscripciones sin ciclos
# El script imprime un resumen como:
# {
#   "processed": 150,
#   "touchedEmptySubscriptions": 12,
#   "totalSubscriptions": 150,
#   "subscriptionsWithoutCycles": 0  ← Debe ser 0
# }
```

**⚠️ Notas importantes:**
- Ejecutar el backfill **después** de aplicar las migraciones de schema
- El script es idempotente: se puede ejecutar múltiples veces sin problema
- En staging: verificar que `subscriptionsWithoutCycles` sea 0 antes de pasar a producción
- Si hay suscripciones sin ciclos tras el backfill, revisar logs de errores

### Resetear Base de Datos (⚠️ PELIGRO)

```bash
npx prisma migrate reset
```

### Seed (Datos de Prueba)

```bash
npm run seed:demo
```

No ejecutar demo data en producción. `npx prisma db seed` queda reservado para bootstrap seguro.

---

## 🔧 Troubleshooting

### Servicio no inicia

```bash
# Ver logs de error
pm2 logs crm-sus-admin --err

# Ver detalles del servicio
pm2 show crm-sus-admin

# Verificar variables de entorno
pm2 restart crm-sus-admin --update-env
```

### Error de Base de Datos

```bash
# Verificar conexión
npx prisma db pull

# Regenerar Prisma Client
npx prisma generate
```

### Error de Build

```bash
# Limpiar caché
npm run clean

# Reinstalar dependencias
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build
```

---

## 📝 Comandos de Producción

```bash
# Deploy completo
./scripts/deploy.sh

# Ver estado
pm2 status

# Ver logs
pm2 logs --lines 50

# Reiniciar servicios
pm2 restart all

# Limpiar logs viejos
pm2 flush
```

---

## ✅ Checklist Pre-Deploy

- [ ] Variables de entorno configuradas en `.env`
- [ ] Base de datos accesible
- [ ] Migraciones probadas en staging
- [ ] Build local exitoso
- [ ] PM2 instalado (`pm2 -v`)
- [ ] Permisos de ejecución en scripts (`chmod +x scripts/*.sh`)
- [ ] **Backfill de ciclos ejecutado** (si hay suscripciones existentes)
- [ ] **Verificar `subscriptionsWithoutCycles: 0`** tras backfill

---

## 🎯 Post-Deploy

- [ ] Verificar que todos los servicios estén `online`
- [ ] Revisar logs en busca de errores
- [ ] Probar endpoints principales
- [ ] Verificar webhooks de Wompi
- [ ] Monitorear memoria y CPU (`pm2 monit`)

---

**Última actualización:** Marzo 2026
**Versión:** 2.0.0
