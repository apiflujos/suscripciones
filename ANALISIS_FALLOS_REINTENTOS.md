# Análisis de Fallos en Reintentos de Cobro

## 🔴 Causas Raíz Identificadas

### 1. **Débito Automático Deshabilitado** (Línea 124)
```typescript
if (!autoDebitConfig.enabled) {
  // Skip o crea link de pago (si está configurado)
}
```

**Solución:** Verificar configuración en producción:
```bash
# En .env o variables de PM2
AUTO_DEBIT_ENABLED=true
AUTO_DEBIT_DISABLED_FALLBACK_LINK=true  # Para crear link si falla débito
```

---

### 2. **Cliente Sin Token de Pago** (Línea 147)
```typescript
if (msg === "customer_payment_source_missing") {
  // Crea link de pago como fallback
}
```

**Causa:** El cliente no tiene tarjeta tokenizada en Wompi.

**Solución:** 
- Verificar que los clientes tengan `metadata.wompi.paymentSourceId`
- Ejecutar sincronización de Chatwoot que tokeniza
- Crear link de tokenización

---

### 3. **Cobro Pendiente Reciente** (Línea 55-75)
```typescript
const recentPendingAutoCharge = await prisma.payment.findFirst({
  where: {
    subscriptionId,
    status: "PENDING",
    wompiTransactionId: { not: null },
    createdAt: { gte: new Date(now.getTime() - safetyWindowMinutes * 60 * 1000) }
  }
});
```

**Causa:** Ya existe un cobro pendiente en las últimas 24h (por defecto).

**Problema:** La ventana de seguridad es MUY GRANDE (24h). Si un cobro falla, no se reintenta hasta que pase la ventana.

**Solución:** Reducir ventana de seguridad:
```bash
# .env
AUTO_DEBIT_RETRY_EVERY_MINUTES=60  # 1 hora en vez de 24h
```

---

### 4. **Fecha de Cobro No Vencida** (Línea 96-115)
```typescript
if (dueAt && now.getTime() + 5_000 < dueAt.getTime()) {
  return { status: "deferred", reason: "not_due_yet" };
}
```

**Causa:** El sistema calcula que aún no es fecha de cobro.

**Problema:** Usa `currentPeriodEndAt` Y `lastPayment.paidAt`, tomando la fecha MÁS lejana.

---

### 5. **Fallo en createAutoDebitTransactionForSubscription**

**Causas posibles:**
- Email del cliente faltante
- Payment source ID inválido
- Wompi API error
- Moneda inválida
- Monto inválido

---

## ✅ Reparaciones Críticas Necesarias

### 1. Reducir Ventana de Seguridad

**Archivo:** `packages/core/src/jobs/handlers/paymentRetry.ts`

**Problema:** 24h es demasiado. Si falla a las 9 PM, no reintenta hasta las 9 PM del día siguiente.

**Solución:**
```typescript
// Cambiar línea 46
const safetyWindowMinutes = Math.max(60, retryWindowMinutes); // 1 hora mínimo en vez de 120
```

---

### 2. Agregar Logs Detallados de Fallos

**Problema:** No sabemos POR QUÉ falla `createAutoDebitTransactionForSubscription`.

**Solución:** Agregar más logs:
```typescript
} catch (err: any) {
  const msg = err?.message ? String(err.message) : "unknown error";
  
  // NUEVO: Log detallado del error
  await systemLog(
    LogLevel.ERROR,
    "jobs.payment_retry",
    "Fallo en createAutoDebitTransactionForSubscription",
    {
      subscriptionId,
      customerId: sub.customerId,
      error: msg,
      stack: err?.stack,
      customerHasEmail: Boolean(sub.customer?.email),
      customerHasMetadata: Boolean(sub.customer?.metadata)
    }
  ).catch(() => {});
  
  // ... resto del código
}
```

---

### 3. Validar Datos del Cliente Antes de Cobrar

**Problema:** Se intenta cobrar sin validar email y payment source.

**Solución:** Agregar validación temprana:
```typescript
if (mode === "AUTO_DEBIT") {
  // Validar email
  const customer = await prisma.customer.findUnique({
    where: { id: sub.customerId },
    select: { email: true, metadata: true }
  });
  
  if (!customer?.email) {
    await systemLog(LogLevel.ERROR, "jobs.payment_retry", "Cliente sin email", {
      subscriptionId,
      customerId: sub.customerId
    }).catch(() => {});
    throw new Error("customer_email_required");
  }
  
  // Validar payment source
  const paymentSourceId = customer.metadata?.wompi?.paymentSourceId;
  if (!paymentSourceId) {
    await systemLog(LogLevel.WARN, "jobs.payment_retry", "Cliente sin token", {
      subscriptionId,
      customerId: sub.customerId
    }).catch(() => {});
    // Crear link de tokenización en vez de fallar
    // ...
  }
}
```

---

### 4. Notificar Cuando Falla Reintento

**Problema:** Cuando falla un reintento, NO se notifica al usuario ni al admin.

**Solución:** Crear notificación de fallo:
```typescript
if (!isMissingSource) {
  // NUEVO: Notificar fallo
  await systemLog(
    LogLevel.ERROR,
    "jobs.payment_retry",
    "Reintento de cobro fallido - se creó link de emergencia",
    {
      subscriptionId,
      error: msg,
      fallbackLinkCreated: true
    }
  ).catch(() => {});
  
  // Disparar notificación de pago fallido
  await schedulePaymentStatusNotifications({ 
    paymentId: newlyCreatedPayment.id, 
    forceNow: true 
  }).catch(() => {});
}
```

---

### 5. Panel de Control de Fallos

**Problema:** No hay vista para ver reintentos fallidos.

**Solución:** Endpoint para ver fallos:
```typescript
// GET /api/logs/payment-retries/failed
logsRouter.get("/payment-retries/failed", async (req, res) => {
  const failedJobs = await prisma.retryJob.findMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: "FAILED"
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      // Incluir información de suscripción y cliente
    }
  });
  
  res.json({ jobs: failedJobs });
});
```

---

## 📋 Configuración Recomendada para Producción

```bash
# Habilitar débito automático
AUTO_DEBIT_ENABLED=true

# Crear link si falla débito (CRÍTICO)
AUTO_DEBIT_DISABLED_FALLBACK_LINK=true

# Reintentar cada 1 hora (no 24h)
AUTO_DEBIT_RETRY_EVERY_MINUTES=60

# Máximo 5 reintentos
AUTO_DEBIT_MAX_RETRIES=5

# Ventana de seguridad de 2h (no 24h)
AUTO_DEBIT_SAFETY_WINDOW_MINUTES=120

# Notificar fallos
NOTIFY_ON_RETRY_FAILURE=true
```

---

## 🔍 Comandos para Debug

### Ver reintentos fallidos
```bash
curl "https://api.tu-dominio.com/api/logs/jobs?type=PAYMENT_RETRY&status=FAILED"
```

### Ver configuración actual
```bash
curl "https://api.tu-dominio.com/api/config/auto-debit"
```

### Forzar reintento manual
```bash
curl -X POST "https://api.tu-dominio.com/api/subscriptions/UUID/retry-now"
```

---

## 🎯 Acciones Inmediatas

1. **Verificar configuración en producción:**
   ```bash
   pm2 show crm-sus-api
   # Verificar AUTO_DEBIT_ENABLED=true
   ```

2. **Reducir ventana de seguridad:**
   - Editar `paymentRetry.ts` línea 46
   - Cambiar `120` a `30` (30 minutos)

3. **Agregar logs detallados:**
   - Ver errores reales de `createAutoDebitTransactionForSubscription`

4. **Crear endpoint de fallback:**
   - Para crear links de pago/tokenización manualmente
