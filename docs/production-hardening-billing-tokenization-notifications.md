# Billing / Tokenización / Notificaciones

Fecha: 2026-04-28

## Objetivo

Dejar los flujos de:

- tokenización
- creación/envío de links de pago
- cobro automático/manual
- checkouts públicos
- notificaciones automáticas

con lógica canónica, tipado fuerte, validaciones consistentes y comportamiento predecible en producción.

## Arquitectura actual

### 1. Tokenización

Generación:

- `apps/admin/app/billing/actions.ts`
- `apps/admin/app/api/customers/send-tokenization-link/route.ts`
- `packages/core/src/services/publicCheckoutLinks.ts`

Lectura pública:

- `apps/admin/app/public/tokenization-links/[token]/route.ts`
- `apps/admin/app/public/tokenize/[token]/page.tsx`

Procesamiento:

- `apps/admin/app/public/tokenize/[token]/process/route.ts`
- `apps/admin/app/admin/_services/customers.ts#createWompiPaymentSource`
- `apps/admin/app/admin/_services/customers.ts#consumeTokenizationLink`

Guardado directo de tarjeta:

- `apps/admin/app/customers/[id]/payment-method/page.tsx`
- `apps/admin/app/customers/[id]/payment-method/process/route.ts`

### 2. Links de pago

Generación:

- `apps/admin/app/billing/actions.ts`
- `apps/admin/app/products/actions.ts`
- `apps/admin/app/api/customers/send-payment-link/route.ts`
- `packages/core/src/services/publicCheckoutLinks.ts`

Asociación / cobro:

- `apps/admin/app/admin/_services/subscriptions.ts`
- `packages/core/src/services/subscriptionBilling.ts`

### 3. Cobro automático y manual

Cobro manual:

- `apps/admin/app/billing/actions.ts#chargeSubscriptionNow`
- `apps/admin/app/admin/_services/subscriptions.ts#chargeSubscriptionNow`

Cobro automático / retries:

- `packages/core/src/jobs/runner.ts`
- `packages/core/src/jobs/handlers/paymentRetry.ts`
- `packages/core/src/services/subscriptionBilling.ts`

### 4. Notificaciones automáticas

Configuración:

- `packages/core/src/services/notificationsConfig.ts`
- `apps/admin/app/notifications/actions.ts`
- `apps/admin/app/admin/notifications/config/route.ts`

Programación:

- `packages/core/src/services/notificationsScheduler.ts`

Dispatch:

- `packages/core/src/jobs/handlers/subscriptionReminder.ts`

### 5. Configuración de checkout público

Lectura:

- `packages/core/src/services/checkoutConfig.ts`
- `apps/admin/app/admin/_services/settings.ts`

Persistencia:

- `apps/admin/app/admin/_services/settingsActions.ts#updateCheckoutConfig`

## Contratos canónicos

### Customer metadata

Fuente de verdad:

- `packages/core/src/lib/customerMetadata.ts`

Bloques críticos:

- `tokenizationLink`
- `paymentLink`
- `cartLink`
- `wompi`
- `chatwoot`

Regla:

- ningún flujo crítico debe leer/escribir metadata “a mano” si existe helper compartido.

### Notifications config

Fuente de verdad:

- `packages/core/src/services/notificationsConfig.ts`

Contratos:

- `NotificationsConfig`
- `NotificationRule`
- `NotificationTemplate`
- `NotificationTrigger`
- `NotificationPaymentType`

Regla:

- UI, server y scheduler deben resolver reglas con la misma semántica.

### Checkout config

Fuente de verdad:

- `packages/core/src/services/checkoutConfig.ts`

Regla:

- lectura y normalización deben pasar por el mismo parser.

## Hallazgos ya confirmados

### 1. Tokenización pública podía perder `paymentSourceId`

Causa:

- el flujo reescribía `Customer.metadata` usando una copia vieja del customer después de crear el payment source.

Estado:

- corregido en `apps/admin/app/public/tokenize/[token]/process/route.ts`

### 2. Reglas de notificación podían quedar mal tipadas

Causa:

- reglas legacy o mal guardadas con `PAYMENT_LINK_CREATED` + `paymentType = LINK` para casos de suscripción.

Estado:

- ahora se normalizan al leer en `packages/core/src/services/notificationsConfig.ts`

### 3. Divergencia entre UI, server y scheduler

Causa:

- cada capa resolvía reglas con lógica propia.

Estado:

- `billing` y UI ya usan resolvedor compartido
- scheduler ya usa filtro tipado compartido

### 4. Checkout config se parseaba de forma repetida

Causa:

- `JSON.parse` ad hoc en varios puntos.

Estado:

- centralizado en `packages/core/src/services/checkoutConfig.ts`

## Hallazgos pendientes

### Alta prioridad

1. `apps/admin/app/notifications/actions.ts`

- sigue usando bastante `any`
- aún hace manipulación manual de rules/templates
- necesita converger a helpers tipados y builders canónicos

2. `apps/admin/app/admin/_services/settingsActions.ts#updateCheckoutConfig`

- persiste payload libre
- conviene alinearlo con `checkoutConfigSchema` / normalización compartida

3. `apps/admin/app/billing/actions.ts`

- mejoró en resolución de notificaciones
- aún conserva muchos `any` fuera del eje recién endurecido

4. `apps/admin/app/admin/_services/subscriptions.ts`

- es el núcleo de cobro
- necesita segunda pasada de tipado en:
  - lectura de metadata
  - resultados de cobro
  - estados de ciclo/pago

### Media prioridad

1. `packages/core/src/services/notificationsScheduler.ts`

- todavía mezcla payloads inline y jobs con payload JSON sin schema formal
- conviene tipar payloads por trigger

2. `apps/admin/app/public/tokenization-links/[token]/route.ts`

- aún resuelve `productId`/`plan` con fragmentos legacy
- puede endurecerse más con helper compartido

3. `apps/admin/app/admin/_services/settings.ts`

- aún tiene parsing manual en `AUTO_DEBIT_CONFIG` y `PAYMENTS_CONFIG`
- conviene extraer schemas dedicados

## Decisiones recomendadas

1. Una sola semántica de reglas.

- exact match por `trigger`
- exact match por `paymentType` cuando aplica
- regla genérica solo si no exige tipo
- nunca “primera regla que aparezca”

2. Un solo lector de metadata.

- toda lectura de `Customer.metadata` debe pasar por `readCustomerMetadata`

3. Configuración leída y escrita por schema.

- checkout
- auto debit
- payments
- notifications

4. Scheduler sin heurística implícita.

- programar solo reglas válidas
- no asumir `SUBSCRIPTION` donde el trigger no tiene payment type

5. Logs de causa.

- cuando un flujo no envía:
  - falta template
  - falta regla
  - regla filtrada por payment type
  - falta payment source
  - falta checkout template
  - redirect base inválido

## Checklist de reparación

### Fase 1

- [x] Unificar lectura de `Customer.metadata`
- [x] Corregir pérdida de `paymentSourceId`
- [x] Unificar resolvedor de reglas en UI/server
- [x] Unificar filtro de reglas en scheduler
- [x] Centralizar parser de checkout config

### Fase 2

- [ ] Tipar y endurecer `notifications/actions.ts`
- [ ] Tipar payloads del scheduler por trigger
- [ ] Tipar `settingsActions` para checkout/auto-debit/payments
- [ ] Endurecer `subscriptions.ts` en cobro y billing cycles

### Fase 3

- [ ] Agregar pruebas de regresión para:
  - tokenización pública
  - guardar tarjeta desde contactos
  - envío de tokenización desde billing
  - envío de link de pago de suscripción
  - cobro manual con y sin payment source
  - scheduler de notificaciones automáticas

## Checklist de producción

- [ ] `CHECKOUT_CONFIG` válido y consistente
- [ ] templates públicos correctos por producto/tipo
- [ ] reglas `PAYMENT_LINK_CREATED` correctas para `LINK` y `SUBSCRIPTION`
- [ ] regla `TOKENIZATION_LINK_CREATED` activa
- [ ] `AUTO_DEBIT_CONFIG` consistente
- [ ] credenciales Wompi correctas
- [ ] credenciales Chatwoot correctas
- [ ] HTML sin caché vieja en admin
- [ ] rebuild/redeploy completo
- [ ] smoke tests funcionales sobre links/tokenización/cobro
