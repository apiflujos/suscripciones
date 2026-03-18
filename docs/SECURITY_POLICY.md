Seguridad - Politica Base (Etapa 0)
=================================

Objetivo
--------
Definir una politica unica de autenticacion, autorizacion y auditoria para toda la app (Next.js App Router), incluyendo API routes, server actions, webhooks y jobs.

Alcance
-------
- Todas las rutas bajo `/admin`, `/api`, `/webhooks`, `/public`.
- Server actions expuestas desde UI.
- Jobs internos (runner) cuando invoquen servicios sensibles.

Modelo de autenticacion
-----------------------
1. Todos los endpoints requieren JWT valido.
2. JWT via `Authorization: Bearer <token>` o `X-Auth-Token`.
3. Tokens deben usar HS256 o RS256.
4. TTL corto (15-30 min) + refresh tokens rotativos.
5. Claims minimos: `sub`, `role`, `permissions`, `iat`, `exp`, `tenantId`.
6. Se prohibe almacenar o loguear tokens en texto plano.

Modelo de autorizacion (RBAC)
-----------------------------
Permisos por recurso. Ejemplos:
- `customers:read`, `customers:write`
- `subscriptions:read`, `subscriptions:write`
- `payments:read`, `payments:write`
- `webhook:receive`
- `audit:read`

Cada endpoint define permisos requeridos. Sin permisos -> 403.

Rate limiting
-------------
- Obligatorio en todas las rutas API y webhooks.
- Politica base: 60 req/min por IP, endpoints criticos 10 req/min.

Webhooks
--------
- JWT obligatorio + permiso `webhook:receive`.
- Validar tenant/identificadores.
- Auditar: payload, token hash, actor, timestamp, resultado.

Logs y auditoria
----------------
- Loguear eventos de auth, accesos sensibles, webhooks y errores.
- Campos minimos: `timestamp`, `nivel`, `actor`, `ip`, `accion`, `resultado`.
- Retencion: 60 dias, purge automatico.
- Acceso a logs: permiso `audit:read`.

Archivos
--------
- Archivos privados via endpoints autenticados o URLs firmadas temporales.
- No servir archivos sensibles en rutas publicas sin control.

Errores
-------
- No exponer detalles internos al cliente.
- Todo error inesperado debe registrarse.

