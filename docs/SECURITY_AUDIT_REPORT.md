# Informe de Auditoría de Seguridad - Suscripciones (Admin)

## Resumen ejecutivo
La aplicación **cumple parcialmente** con los requisitos de seguridad exigidos. Se implementó autenticación JWT obligatoria, RBAC por ruta/método, rate limiting global, CORS y security headers. También se protegieron webhooks y enlaces públicos con tokens firmados. Persisten brechas relevantes en rate limiting distribuido, cobertura total de auditoría y calidad de tipado.

## Descripción general de la aplicación
- Stack: Next.js App Router, Prisma, PostgreSQL.
- Autenticación: JWT HS256 en `Authorization: Bearer` o `X-Auth-Token`.
- RBAC: permisos centralizados por ruta y método.
- Backend: API Routes y server actions.
- Logs: Pino + SystemLog en DB.

## Evaluación por área de seguridad

### 1. Autenticación y autorización en endpoints
- **Cumple (parcial)**.
- Evidencias: `apps/admin/middleware.ts`, `apps/admin/app/api/_lib/requireApiSession.ts`, `apps/admin/app/admin/_lib/requireAdminToken.ts`, `apps/admin/lib/rbac.ts`.
- Hallazgos: rutas de bootstrap/login están permitidas por middleware (necesario). Se agregó `BOOTSTRAP_TOKEN` opcional para exigir un token extra en producción.

### 2. Manejo de tokens y secretos
- **Cumple (parcial)**.
- Evidencias: `apps/admin/lib/jwt.ts`, `apps/admin/lib/publicTokens.ts`, `apps/admin/lib/mediaAuth.ts`, `.env.example`.
- Hallazgos: tokens públicos firmados existen, pero el “one‑time” no se aplica universalmente (pago/plan no marcan uso). Se recomienda invalidación al uso o expiraciones más cortas.

### 3. Webhooks
- **Cumple**.
- Evidencias: `apps/admin/app/webhooks/wompi/route.ts`, `apps/admin/app/webhooks/chatwoot/route.ts`, `apps/admin/lib/rbac.ts`.
- Hallazgos: faltan validaciones adicionales de scope por tenant en el payload.

### 4. WebSockets
- **No aplica (no existen)**.
- Evidencias: no hay endpoints WS en código (`rg websocket|ws|socket`).

### 5. Logging y auditoría
- **Cumple (parcial)**.
- Evidencias: `packages/core/src/lib/logger.ts`, `packages/core/src/services/systemLog.ts`.
- Hallazgos: retención configurable, pero falta una política uniforme de auditoría para todos los accesos críticos y verificación explícita de `audit:read` en cada endpoint que exponga logs.

### 6. Configuración de seguridad (headers, CORS, rate limiting, fail2ban, npm audit)
- **Cumple (parcial)**.
- Evidencias: `apps/admin/middleware.ts`, `apps/admin/lib/rateLimit.ts`.
- Hallazgos: rate limit es in-memory, no distribuido; no hay evidencia de npm audit en CI.

### 7. Protección de archivos y sanitización
- **Cumple (parcial)**.
- Evidencias: `apps/admin/app/public/media/[filename]/route.ts`, `apps/admin/lib/mediaAuth.ts`.
- Hallazgos: falta estandarizar validación de payloads en todas las rutas.

### 8. Tipado y calidad de código
- **No cumple totalmente**.
- Evidencias: uso de `any` en servicios `apps/admin/app/admin/_services/*`.
- Hallazgos: se requiere migrar a `unknown` + Zod.

### 9. Reglas de negación explícitas
- **Cumple (parcial)**.
- Evidencias: middleware JWT + RBAC y redacción de tokens en logs.
- Hallazgos: login/refresh públicos sin segunda barrera opcional.

## Vulnerabilidades encontradas

| ID | Descripción | Criticidad | Archivo/Línea | Recomendación |
| --- | --- | --- | --- | --- |
| V1 | Rate limiting in-memory (no distribuido) | Alta | `apps/admin/lib/rateLimit.ts` | Migrar a Redis/Upstash |
| V2 | Login/refresh sin 2FA/secret extra (mitigado con `BOOTSTRAP_TOKEN`) | Media | `apps/admin/middleware.ts` | Mantener token en producción o allowlist IP |
| V3 | Auditoría incompleta | Media | `packages/core/src/services/systemLog.ts` | Unificar auditoría y permisos |
| V4 | Uso de `any` | Media | `apps/admin/app/admin/_services/*` | Migrar a `unknown` + Zod |

## Plan de acción priorizado

### Inmediato (criticidad alta)
- Implementar rate limit distribuido (Redis/Upstash).
- Mantener `BOOTSTRAP_TOKEN` activo en producción para login/refresh.

### Corto plazo (criticidad media)
- Estándar de auditoría para accesos críticos y validación de `audit:read`.
- Reducir `any` en servicios.

### Largo plazo / Mejoras (criticidad baja)
- Integrar `npm audit` en CI.
- Fail2ban documentado a nivel infraestructura.

## Buenas prácticas adicionales sugeridas
- Rotación periódica de `JWT_SECRET`.
- Validación de scope por tenant en webhooks.
- Política uniforme de expiración corta en tokens públicos.

## Notas adicionales
- Si el despliegue usa múltiples instancias, el rate limit actual es insuficiente.
- No hay WebSockets implementados, por lo que ese requisito no aplica por ahora.
