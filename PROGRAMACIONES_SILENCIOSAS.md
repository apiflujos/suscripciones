# Programaciones Silenciosas - Análisis y Soluciones

## 🔴 Problema Crítico Identificado

Existen **programaciones silenciosas** en el backend que ejecutan cobros sin mostrarse en el frontend.

### Jobs Silenciosos Encontrados

#### 1. `ensureDueCutoffRetries()` - `packages/core/src/jobs/runner.ts`

**Qué hace:** Escanea suscripciones activas/past_due cuya fecha de corte (`currentPeriodEndAt`) está próxima o vencida, y crea jobs de cobro automático **sin notificar**.

**Código (línea ~420):**
```typescript
const candidates = await prisma.subscription.findMany({
  where: {
    status: { in: ["ACTIVE", "PAST_DUE"] },
    currentPeriodEndAt: { lte: dueUntil }  // ← Fecha de corte próxima/vencida
  },
  // ...
});

// Crea job de cobro sin notificación
await ensurePaymentRetryJob({
  subscriptionId: sub.id,
  runAt: new Date(),  // ← Ejecución inmediata
  maxAttempts: 5
});
```

**Problema:** 
- No se muestra en el frontend
- No hay fecha de reintento visible
- El usuario no sabe cuándo se intentará el próximo cobro

---

#### 2. `subscriptionReminder()` - Notificaciones Automáticas

**Qué hace:** Programa notificaciones basadas en `currentPeriodEndAt` + offsets de reglas.

**Problema:** Si `currentPeriodEndAt` está configurado a una hora específica (ej: 9:30 PM), las notificaciones se programan a esa hora.

---

## ✅ Soluciones Implementadas

### 1. Endpoint para Fecha de Reintento Manual

**Endpoint:** `POST /api/subscriptions/:id/set-retry-date`

**Funcionalidad:**
- Establece fecha de reintento visible y editable
- Guarda en `metadata.manualRetry.nextRetryAt`
- Crea job `PAYMENT_RETRY` programado
- Cancela jobs existentes si se cambia la fecha
- Logs con trazabilidad completa

**Request:**
```json
{
  "nextRetryAt": "2026-03-15T10:00:00Z",
  "actorEmail": "usuario@empresa.com"
}
```

**Logs generados:**
```
Actor: "usuario@empresa.com"
Mensaje: "Fecha de reintento manual establecida"
Contexto: { subscriptionId, nextRetryAt, status }
```

---

### 2. Componente UI: RetryDateField

**Archivo:** `apps/admin/app/billing/RetryDateField.tsx`

**Características:**
- Muestra fecha de corte y fecha de reintento
-Editable con picker de fecha/hora
- Indicador visual si está vencida
- Botón para limpiar fecha

**Uso:**
```tsx
<RetryDateField
  subscriptionId={subscription.id}
  currentPeriodEndAt={subscription.currentPeriodEndAt}
  nextRetryAt={subscription.metadata?.manualRetry?.nextRetryAt}
  csrfToken={csrfToken}
  returnTo="/billing"
/>
```

---

### 3. Endpoint para Ver Jobs Pendientes

**Endpoint:** `GET /api/logs/notifications/jobs`

**Respuesta:**
```json
{
  "jobs": [
    {
      "id": "...",
      "status": "PENDING",
      "runAt": "2026-03-15T10:00:00Z",
      "_enriched": {
        "subscription": {
          "id": "...",
          "status": "PAST_DUE",
          "currentPeriodEndAt": "2026-03-10T21:30:00Z",
          "customer": { "name": "...", "email": "..." }
        },
        "rulesConfigured": true,
        "rulesCount": 2,
        "payloadCycle": 3,
        "anchorAt": "2026-03-10T21:30:00Z",
        "trigger": "SUBSCRIPTION_DUE"
      }
    }
  ]
}
```

---

### 4. Script de Limpieza

**Archivo:** `packages/core/src/scripts/cleanup-orphan-notification-jobs.ts`

**Ejecución:**
```bash
npx tsx packages/core/src/scripts/cleanup-orphan-notification-jobs.ts
```

**Limpia:**
- Jobs de suscripciones inexistentes
- Jobs de suscripciones canceladas/expiradas
- Jobs con ciclo desactualizado
- Jobs con anchorAt desactualizado
- Jobs > 7 días

---

## 📋 Próximos Pasos (Pendientes)

### 1. Integrar RetryDateField en Billing Page

**Archivo:** `apps/admin/app/billing/page.tsx`

Agregar en `renderBillingCard`:
```tsx
<div className="billing-body-section">
  <div className="billing-section-title">Fechas de cobro</div>
  <RetryDateField
    subscriptionId={r.id}
    currentPeriodEndAt={r.vencimientoAt}
    nextRetryAt={r.metadata?.manualRetry?.nextRetryAt}
    csrfToken={csrfToken}
    returnTo={returnTo}
  />
</div>
```

### 2. Agregar `nextRetryAt` al Backend de Billing

**Archivo:** `packages/core/src/routes/billing.ts` (o donde se construyen las filas)

Incluir en la respuesta:
```typescript
{
  // ... campos existentes
  nextRetryAt: s.metadata?.manualRetry?.nextRetryAt || null
}
```

### 3. Hacer Transparentes los Jobs de `ensureDueCutoffRetries`

**Opción A:** Deshabilitar y usar solo fechas manuales
```bash
# .env
AUTO_DEBIT_CHARGE_AT_CUTOFF_ENABLED=false
```

**Opción B:** Que cree fecha visible en metadata
```typescript
// En ensureDueCutoffRetries, después de crear el job:
await prisma.subscription.update({
  where: { id: sub.id },
  data: {
    metadata: {
      ...sub.metadata,
      autoRetry: {
        nextRetryAt: job.runAt.toISOString(),
        scheduledAt: new Date().toISOString(),
        source: "ensureDueCutoffRetries"
      }
    }
  }
});
```

### 4. Panel de Control de Jobs

Crear vista `/billing/jobs` para ver todos los jobs programados:
- Jobs de reintento por fecha
- Jobs de notificaciones
- Jobs de webhooks pendientes
- Filtros por suscripción/cliente

---

## 🎯 Configuración Recomendada

### Para Producción

```bash
# Mostrar siempre fechas de reintento
AUTO_DEBIT_CHARGE_AT_CUTOFF_ENABLED=false

# Reintentos solo con fecha manual
AUTO_DEBIT_RETRY_ENABLED=true
AUTO_DEBIT_RETRY_EVERY_MINUTES=1440  # 24 horas

# Notificaciones solo con reglas explícitas
NOTIFICATIONS_CONFIG={"rules":[...]}
```

### Para Debug

```bash
# Logs detallados
LOG_LEVEL=debug

# Escaneo frecuente de jobs (solo debug)
DUE_CUTOFF_SCAN_SECONDS=15
```

---

## 📊 Trazabilidad Completa

Ahora cada acción queda registrada:

| Acción | Actor | Log |
|--------|-------|-----|
| Fecha de reintento establecida | Email del usuario | `subscriptions.retry_date` |
| Job de cobro creado (manual) | `manual` | `subscriptions.retry_date` |
| Job de cobro creado (auto) | `job:paymentRetry` | `jobs.payment_retry` |
| Notificación programada | `job:subscriptionReminder` | `notifications.schedule` |
| Webhook procesado | `webhook:wompi` | `webhooks.wompi` |

---

## 🔍 Comandos Útiles

### Ver jobs pendientes de una suscripción
```bash
curl "https://api.tu-dominio.com/api/logs/notifications/jobs?subscriptionId=UUID"
```

### Limpiar jobs huérfanos
```bash
pm2 exec 0 "npx tsx packages/core/src/scripts/cleanup-orphan-notification-jobs.ts"
```

### Establecer fecha de reintento
```bash
curl -X POST "https://api.tu-dominio.com/api/subscriptions/UUID/set-retry-date" \
  -H "Content-Type: application/json" \
  -d '{"nextRetryAt":"2026-03-15T10:00:00Z","actorEmail":"admin@empresa.com"}'
```
