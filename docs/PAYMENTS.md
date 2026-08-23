# Módulo de Pagos

Documentación técnica del módulo de pagos e integración con Wompi.

## Tabla de Contenidos

- [Visión General](#visión-general)
- [Flujo de Pagos](#flujo-de-pagos)
- [Referencias Wompi](#referencias-wompi)
- [Endpoints](#endpoints)
- [Servicios Principales](#servicios-principales)
- [Fletes (domicilio)](#fletes-domicilio)
- [Conciliación](#conciliación)
- [Manejo de Errores](#manejo-de-errores)
- [Consideraciones de Seguridad](#consideraciones-de-seguridad)

---

## Visión General

El módulo de pagos gestiona la creación, seguimiento y conciliación de pagos a través de Wompi. Soporta dos modos de cobro:

1. **Manual Link**: Genera link de pago que se envía al cliente
2. **Auto Debit**: Cobra automáticamente usando tokenización de tarjeta

### Reglas operativas vigentes

- Los envíos de cobro usan solo **plantillas WhatsApp** configuradas en Notificaciones.
- Si el flujo depende de checkout público, no se envía nada si falta plantilla o falta checkout público válido.
- Desde `contacts`, sin producto o suscripción asociada, solo se permite enviar catálogo.

**Archivos principales:**
- `packages/core/src/services/subscriptionBilling.ts` - Creación de links y auto-debit
- `packages/core/src/services/wompiReconcile.ts` - Conciliación de transacciones
- `apps/admin/app/admin/payments/[id]/route.ts` - Endpoint de consulta de pagos
- `packages/core/src/lib/wompiSignature.ts` - Firmas e integridad
- `packages/core/src/providers/wompi/client.ts` - Cliente HTTP para Wompi API

---

## Flujo de Pagos

### Payment Link (Manual Link)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  Cliente    │     │  Backend     │     │   Wompi     │     │  Webhook     │
└──────┬──────┘     └──────┬───────┘     └──────┬──────┘     └──────┬───────┘
       │                   │                     │                   │
       │ 1. Solicitar link │                     │                   │
       │──────────────────>│                     │                   │
       │                   │                     │                   │
       │                   │ 2. Crear Payment    │                   │
       │                   │    Link en Wompi    │                   │
       │                   │────────────────────>│                   │
       │                   │                     │                   │
       │                   │ 3. Retornar URL     │                   │
       │                   │<────────────────────│                   │
       │                   │                     │                   │
       │ 4. Enviar URL     │                     │                   │
       │<──────────────────│                     │                   │
       │                   │                     │                   │
       │ 5. Cliente paga   │                     │                   │
       │────────────────────────────────────────>│                   │
       │                   │                     │                   │
       │                   │                     │ 6. Notificar      │
       │                   │                     │    cambio estado  │
       │                   │                     │──────────────────>│
       │                   │                     │                   │
       │                   │ 7. Conciliar        │                   │
       │                   │<────────────────────────────────────────│
       │                   │                     │                   │
       │                   │ 8. Actualizar DB    │                   │
       │                   │    y avanzar ciclo  │                   │
       │                   │                     │                   │
```

### Auto Debit

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Scheduler  │     │  Backend     │     │   Wompi     │
└──────┬──────┘     └──────┬───────┘     └──────┬──────┘
       │                   │                     │
       │ 1. Trigger cobro  │                     │
       │──────────────────>│                     │
       │                   │                     │
       │                   │ 2. Validar          │
       │                   │    payment_source   │
       │                   │                     │
       │                   │ 3. Crear            │
       │                   │    transacción      │
       │                   │────────────────────>│
       │                   │                     │
       │                   │ 4. Retornar         │
       │                   │    transaction_id   │
       │                   │<────────────────────│
       │                   │                     │
       │                   │ 5. Webhook          │
       │                   │    notificación     │
       │                   │<────────────────────│
       │                   │                     │
       │                   │ 6. Conciliar        │
       │                   │    y actualizar     │
       │                   │                     │
```

---

## Referencias Wompi

### Formato de Referencias

| Prefijo | Formato | Descripción | Ejemplo |
|---------|---------|-------------|---------|
| `SUB_` | `SUB_<subscriptionId>_<cycle>` | Pago de suscripción | `SUB_550e8400-e29b-41d4-a716-446655440000_3` |
| `ORDER_` | `ORDER_<externalRef>_<planId>` | Pedido manual | `ORDER_contact_12345_plan_abc` |
| `SHOPIFY_` | `SHOPIFY_<orderId>` | Pedido Shopify | `SHOPIFY_4598732156` |
| `TEST_` | `TEST_<random>` | Transacción prueba | `TEST_abc123` |

### Clasificación de Referencias

**Archivo**: `packages/core/src/webhooks/wompi/classifyReference.ts`

```typescript
export type PaymentSource =
  | { kind: "subscription"; subscriptionId: string; cycle?: number }
  | { kind: "order"; reference: string; planId?: string }
  | { kind: "shopify"; reference: string }
  | { kind: "unknown"; reference: string };

export function classifyReference(reference: string): PaymentSource {
  // Implementación
}
```

---

## Endpoints

### GET `/admin/payments/:id`

Obtiene detalles de un pago específico con conciliación automática si está pendiente.

**Parámetros:**

| Parámetro | Tipo | Required | Descripción |
|-----------|------|----------|-------------|
| `id` | UUID | Sí | ID del pago |

**Response:**

```json
{
  "payment": {
    "id": "uuid",
    "status": "APPROVED",
    "paidAt": "2026-03-08T10:00:00Z",
    "failedAt": null,
    "wompiTransactionId": "12345"
  },
  "lastAttempt": {
    "id": "uuid",
    "status": "TRANSACTION_CREATED",
    "errorCode": null,
    "errorMessage": null,
    "createdAt": "2026-03-08T09:59:00Z"
  }
}
```

**Conciliación Automática:**

Si el pago está `PENDING` y han pasado más de 5 segundos desde su creación:
1. Consulta estado en Wompi
2. Crea evento webhook fake
3. Procesa conciliación
4. Retorna estado actualizado

**Códigos de Error:**

| Código | HTTP | Descripción |
|--------|------|-------------|
| `missing_payment_id` | 400 | No se proporcionó ID |
| `payment_not_found` | 404 | Pago no existe |

---

## Servicios Principales

### createPaymentLinkForSubscription

**Archivo**: `services/subscriptionBilling.ts`

Crea un link de pago en Wompi para una suscripción específica.

**Parámetros:**

```typescript
{
  subscriptionId: string;
  amountInCentsOverride?: number;
  sendNotifications?: boolean;
}
```

**Retorna:**

```typescript
{
  paymentId: string;
  wompiPaymentLinkId: string;
  checkoutUrl: string;
}
```

**Proceso:**

1. Valida estado de suscripción (no cancelada/suspendida/expirada)
2. Valida moneda con `validateWompiCurrency()`
3. Crea/actualiza registro `Payment`
4. Adquiere lock advisory para evitar duplicados
5. Crea Payment Link en Wompi
6. Libera lock
7. Si `sendNotifications === false`, retorna el link sin notificar
8. Si existe regla activa de `PAYMENT_LINK_CREATED`, exige checkout público válido para ese producto
9. Crea o actualiza el checkout público antes de disparar la notificación
10. Programa notificaciones solo si existe plantilla WhatsApp activa y regla habilitada

**Lock Advisory:**

```typescript
const lockKey = `payment-link:${subscriptionId}:${cycle}`;
const locked = await tryAcquirePaymentLinkLock(lockKey);
if (!locked) {
  // Reintentar 4 veces con delay de 250ms
  // Si falla, lanzar error "payment_link_in_progress"
}
```

### createAutoDebitTransactionForSubscription

**Archivo**: `services/subscriptionBilling.ts`

Crea una transacción de cobro automático usando tokenización.

**Parámetros:**

```typescript
{
  subscriptionId: string;
  amountInCentsOverride?: number;
}
```

**Pre-requisitos:**

- `collectionMode === "AUTO_DEBIT"`
- Customer tiene `payment_source_id` tokenizado
- Customer tiene email válido

**Proceso:**

1. Valida modo de cobro
2. Obtiene `payment_source_id` del customer
3. Valida email del customer
4. Genera firma de integridad
5. Crea transacción en Wompi
6. Maneja errores de referencia duplicada

**Firma de Integridad:**

```typescript
const signature = sha256Hex(
  `${reference}${amountInCents}${currency}${integritySecret}`
);
```

---

## Fletes (domicilio)

El monto que se le cobra al cliente incluye el flete cuando el despacho sale de
Medellín. Es un cobro legítimo y deliberado, no un recargo sin explicar.

### Cómo está modelado hoy

El flete vive en **planes separados**, no en un campo del plan:

| Plan | Precio | Incluye |
|---|---|---|
| `Suscripción Alpha` | $360.000 | sin domicilio |
| `Suscripción Alpha con Domicilio (Fuera Medellín)` | $390.000 | + $30.000 de flete |
| `Suscripción Omega  sin Domicilio` | $460.000 | sin domicilio |
| `Plan Omega  sin Domicilio` | $460.000 | sin domicilio |

Hay 16 planes con "domicilio" en el nombre. Existe además un campo previsto para
esto en el esquema — `planMetadata.pricing.shippingInCents`, ver
`packages/core/src/lib/metadataSchemas.ts` — pero hoy está en `0` o `null` en
todos los planes: nadie lo usa.

### El problema que esto causa

Las suscripciones vivas apuntan al plan **sin** domicilio, y se les cobra el monto
**con** domicilio. Los planes con domicilio tienen cero suscripciones asociadas.

El sistema queda entonces contradiciéndose consigo mismo:

```
Suscripción → plan "Suscripción Alpha"  → $360.000   ← lo que el sistema cree
Cobro real  →                             $390.000   ← lo que el cliente paga
```

`getExpectedSubscriptionTotalInCents()` resuelve el total esperado desde el plan,
así que devuelve $360.000. Cuando entra el pago de $390.000, `resolveAssociation`
no encuentra coincidencia exacta de monto y cae al Tier 2, que asocia con menos
confianza y deja este rastro:

```
resolveAssociation: asociando por identidad con diferencia de monto (posible flete)
```

Diferencias observadas en producción (23-ago-2026):

| Plan de la suscripción | Precio del plan | Cobrado | Diferencia | Veces |
|---|---|---|---|---|
| Suscripción Alpha | 360.000 | 390.000 | +30.000 | 66 |
| Suscripción Omega | 460.000 | 480.000 | +20.000 | 10 |
| Suscripción Alpha | 360.000 | 380.000 | +20.000 | 7 |
| Suscripción Alpha | 360.000 | 378.000 | +18.000 | 5 |
| Suscripción Delta | 620.000 | 616.802 | **−3.198** | 1 |

Las cuatro primeras son fletes. **La última no**: es menor que el precio del plan,
así que no puede ser flete. Es un pago aprobado por webhook el 26-jun-2026 y queda
sin explicar.

### Cómo dejarlo bien

Cualquiera de las dos, pero una sola y de forma consistente:

1. **Mover cada suscripción a su plan con domicilio.** No requiere código: los
   planes ya existen con el precio correcto. El monto esperado pasa a coincidir
   con el cobrado y la asociación por monto exacto vuelve a funcionar.
2. **Usar `pricing.shippingInCents`** en el plan base y sumar el flete al total.
   Requiere que `getExpectedSubscriptionTotalInCents` lo contemple, hoy solo lee
   `pricing.totalInCents`.

Mientras se mantenga el desajuste, cada pago con flete entra por el camino de
menor confianza y engorda la cifra de pagos sin suscripción asociada.

---

## Conciliación

### reconcileWompiTransaction

**Archivo**: `services/wompiReconcile.ts`

Concilia una transacción de Wompi consultando la API directamente.

**Parámetros:**

```typescript
{
  wompiTransactionId: string;
  tenantId?: string | null;
  processNow?: boolean;
  checksumPrefix?: string;
}
```

**Proceso:**

1. Valida `wompiTransactionId` no vacío
2. Obtiene tenant (default si no proporcionado)
3. Consulta transacción en Wompi API
4. Valida estado final (`APPROVED`, `DECLINED`, `VOIDED`, `ERROR`)
5. Crea evento webhook fake con checksum único
6. Dispara procesamiento del evento

**Estados Finales:**

```typescript
const FINAL_WOMPI_STATUSES = new Set([
  "APPROVED",
  "DECLINED",
  "VOIDED",
  "ERROR"
]);
```

### reconcileWompiByReference

**Archivo**: `services/wompiReconcile.ts`

Concilia por referencia cuando no se tiene el transaction_id.

**Scoring de Candidatos:**

| Criterio | Puntos |
|----------|--------|
| Matching `paymentLinkId` | +100 |
| Matching `currency` | +20 |
| Matching `amountInCents` | +20 |
| Status `APPROVED` | +10 |

**Proceso:**

1. Lista transacciones por referencia en Wompi
2. Filtra solo estados finales
3. Calcula score para cada una
4. Selecciona la de mayor score
5. Concilia con `reconcileWompiTransaction`

---

## Manejo de Errores

### Errores Comunes

| Error | Causa | Solución |
|-------|-------|----------|
| `wompi_private_key_not_configured` | Falta variable de entorno | Configurar `WOMPI_PRIVATE_KEY` |
| `wompi_integrity_secret_not_configured` | Falta secreto de integridad | Configurar `WOMPI_INTEGRITY_SECRET` |
| `customer_payment_source_missing` | Customer sin tarjeta tokenizada | Tokenizar tarjeta primero |
| `customer_email_required` | Customer sin email | Actualizar customer con email |
| `payment_link_in_progress` | Lock adquirido por otro proceso | Reintentar después |
| `wompi_reference_already_used_guard` | Referencia duplicada en Wompi | Esperar conciliación |

### Error Logging

```typescript
try {
  await reconcileWompiTransaction({...});
  console.log('[PaymentReconcile] Success', { paymentId, wompiTransactionId });
} catch (err: any) {
  console.error('[PaymentReconcile] Failed', {
    paymentId,
    wompiTransactionId,
    error: err?.message
  });
  await systemLog(LogLevel.ERROR, 'payments.reconcile', 'Reconcile failed', {
    paymentId,
    wompiTransactionId,
    error: err?.message
  });
}
```

---

## Consideraciones de Seguridad

### 1. Validación de Moneda

```typescript
const WOMPI_SUPPORTED_CURRENCIES = ['COP', 'USD'];

export function validateWompiCurrency(currency: string): string {
  const normalized = normalizeCurrency(currency);
  if (!WOMPI_SUPPORTED_CURRENCIES.includes(normalized)) {
    throw new Error("unsupported_wompi_currency");
  }
  return normalized;
}
```

### 2. Firmas de Integridad

```typescript
export function buildWompiTransactionSignature(args: {
  reference: string;
  amountInCents: number;
  currency: string;
  integritySecret: string;
}): { signature: string; normalizedReference: string; ... } {
  // Normaliza inputs (remueve zero-width chars)
  const normalizedReference = normalizeReference(args.reference);
  const normalizedAmountInCents = normalizeAmountInCents(args.amountInCents);
  const normalizedCurrency = validateWompiCurrency(args.currency);
  const normalizedIntegritySecret = normalizeIntegritySecret(args.integritySecret);

  // Genera firma SHA256
  const signature = sha256Hex(
    `${normalizedReference}${normalizedAmountInCents}${normalizedCurrency}${normalizedIntegritySecret}`
  );

  return { signature, normalizedReference, normalizedAmountInCents, normalizedCurrency };
}
```

### 3. Advisory Locks

Previene creación duplicada de payment links:

```sql
SELECT pg_try_advisory_lock(hashtext('payment-link:sub-id:cycle')) as locked
```

**Best Practices:**

- Siempre liberar lock en `finally`
- Usar timeouts para evitar deadlocks
- Loguear fallos de adquisición/liberación

### 4. Rate Limiting (Recomendado)

Implementar a nivel de API gateway:

```typescript
// Ejemplo conceptual
const RECONCILE_RATE_LIMIT = new Map<string, { count: number; resetAt: Date }>();

async function canReconcile(paymentId: string): Promise<boolean> {
  const limit = RECONCILE_RATE_LIMIT.get(paymentId);
  if (!limit) return true;
  if (Date.now() > limit.resetAt.getTime()) {
    RECONCILE_RATE_LIMIT.delete(paymentId);
    return true;
  }
  return limit.count < 3; // Máximo 3 reconciles por payment
}
```

---

## Troubleshooting

### Pago queda pendiente indefinidamente

**Causas posibles:**
1. Webhook de Wompi no llegó
2. Error en conciliación automática
3. Lock no se liberó

**Solución:**

```bash
# 1. Verificar logs de reconcile
grep "\[PaymentReconcile\]" logs/*.log

# 2. Forzar conciliación manual
curl -X POST /admin/payments/:id/reconcile

# 3. Verificar locks activos
SELECT * FROM pg_locks WHERE locktype = 'advisory';
```

### Referencia duplicada en Wompi

**Causa:** Reintento automático creó nueva transacción con misma referencia.

**Solución:**

1. Esperar conciliación automática (puede tomar hasta 5 minutos)
2. Si no se concilia, usar `reconcileWompiByReference`
3. Revisar logs de `wompi_reference_already_used_guard`

### Lock no se libera

**Síntomas:**
- Múltiples errores `payment_link_in_progress`
- Logs de `Failed to release lock`

**Solución:**

```sql
-- Identificar locks huérfanos
SELECT pid, usename, application_name, query
FROM pg_stat_activity
WHERE query LIKE '%pg_advisory%';

-- Forzar liberación (último recurso)
SELECT pg_advisory_unlock(hashtext('lock-key'));
```

---

## Changelog

### v1.1.0 (2026-03-08)
- ✅ Fix: Error handling en reconcile de pagos
- ✅ Fix: Lock advisory con proper error handling
- ✅ Fix: Validación de moneda en payment links
- ✅ Fix: formatCop null/undefined handling
- ✅ Feature: Logging estructurado para pagos
- ✅ Feature: Tests unitarios para wompiReconcile

### v1.0.0 (Initial)
- Implementación inicial de pagos con Wompi
