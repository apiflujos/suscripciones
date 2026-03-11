# Análisis Completo - Flujo de Pagos y Reintentos

## 🔴 Problema Crítico Identificado

**SÍNTOMA:** Los reintentos de cobro fallan inmediatamente sin comunicarse con Wompi.

**CAUSA RAÍZ:** Se usa la **misma referencia** `SUB_{id}_{ciclo}` en cada reintento, y Wompi rechaza referencias duplicadas con el error:
```
wompi_reference_already_used_guard
```

---

## ✅ Solución Implementada

### Cambio Crítico en `paymentRetry.ts`

**ANTES:**
```typescript
await createAutoDebitTransactionForSubscription({ 
  subscriptionId, 
  forceNewTransaction: false  // ❌ Usa misma referencia
});
```

**AHORA:**
```typescript
await createAutoDebitTransactionForSubscription({ 
  subscriptionId, 
  forceNewTransaction: true  // ✅ Genera referencia única: R1, R2, R3...
});
```

---

## 📊 Flujo Completo de Pagos (10/10)

### 1. **Creación de Suscripción**
```
POST /api/subscriptions
  ↓
createPaymentLinkForSubscription()
  ↓
reference = "SUB_{id}_1"  // Ciclo 1
  ↓
Crea Payment (status: PENDING)
  ↓
Crea PaymentLink en Wompi
  ↓
Retorna checkoutUrl
```

---

### 2. **Fecha de Corte Automática**

**Job:** `ensureDueCutoffRetries()` (runner.ts)

```
Cada 30 segundos:
  ↓
Busca suscripciones con currentPeriodEndAt <= ahora
  ↓
Para cada una:
  ↓
  Verifica si ya hay job pendiente (ventana: 30 min)
    - Si hay → skip
    - Si no hay → crea job PAYMENT_RETRY
  ↓
Guarda en metadata.autoRetry.nextRetryAt
```

---

### 3. **Reintento de Cobro (PAYMENT_RETRY)**

**Job:** `paymentRetry()` (paymentRetry.ts)

```
payload: { subscriptionId, ... }
  ↓
Adquiere lock (evita duplicados)
  ↓
Valida email del cliente
  ↓
Valida payment source (si es AUTO_DEBIT)
  ↓
Verifica fecha de cobro (dueAt)
  ↓
Verifica pagos pendientes recientes (ventana: 30 min)
  ↓
Si es AUTO_DEBIT:
  ↓
  createAutoDebitTransactionForSubscription({
    forceNewTransaction: true  // ← CLAVE
  })
    ↓
    Si ya existe wompiTransactionId:
      - Genera referencia nueva: "SUB_{id}_{ciclo}_R1"
      - Limpia wompiTransactionId anterior
      - Guarda reintento en metadata
    ↓
    Crea transacción en Wompi con referencia única
  ↓
  ÉXITO → status: "processed"
  ↓
  FALLA → catch
    - Log detallado con error
    - Fallback: crea link de pago manual
    - Retorna como procesado (con link)
```

---

### 4. **Webhook de Wompi**

**Endpoint:** `POST /api/webhooks/wompi`

```
Recibe webhook
  ↓
Verifica firma (integritySecret)
  ↓
Clasifica referencia:
  - SUB_{id}_{ciclo} → Suscripción
  - SUB_{id}_{ciclo}_R1 → Reintento
  - LINK_{uuid} → Link de pago
  ↓
processWompiEvent()
  ↓
Busca payment por wompiTransactionId O reference
  ↓
Actualiza status (APPROVED/DECLINED/ERROR)
  ↓
Si APPROVED:
  - Actualiza suscripción (currentCycle++, currentPeriodEndAt)
  - Programa siguiente notificación
  ↓
Si DECLINED:
  - Crea job de reintento (si está habilitado)
  - Notifica por Chatwoot
```

---

### 5. **Notificaciones Automáticas**

**Trigger:** `SUBSCRIPTION_DUE`

```
scheduleSubscriptionDueNotifications()
  ↓
Busca reglas configuradas
  ↓
Para cada regla:
  ↓
  Calcula offset (ej: -1 día, +0 días)
  ↓
  Crea job SUBSCRIPTION_REMINDER
    payload: {
      trigger: "SUBSCRIPTION_DUE",
      ruleId: "...",
      subscriptionId: "...",
      cycleNumber: 3,
      anchorAt: "2026-03-10T21:30:00Z",
      offsetSeconds: -86400  // 1 día antes
    }
  ↓
  Job se ejecuta en runAt
    ↓
    subscriptionReminder()
      ↓
      Valida payload
      ↓
      Busca plantilla
      ↓
      Renderiza mensaje
      ↓
      Crea ChatwootMessage
      ↓
      Envía por Chatwoot
```

---

### 6. **Pagos Manuales (Charge Now)**

**Endpoint:** `POST /api/subscriptions/:id/charge-now`

```
Verifica fecha de corte (debe estar vencida)
  ↓
Verifica modo (AUTO_DEBIT o AUTO_LINK)
  ↓
Verifica configuración (allowManualCharge)
  ↓
createAutoDebitTransactionForSubscription({
  forceNewTransaction: true
})
  ↓
Genera referencia: "SUB_{id}_{ciclo}_MANUAL"
  ↓
Crea transacción en Wompi
```

---

## 🎯 Alineación Perfecta

### Fechas Clave

| Fecha | Qué es | Dónde se usa |
|-------|--------|--------------|
| `currentPeriodEndAt` | Fecha de corte | Jobs, notificaciones, UI |
| `nextRetryAt` | Próximo reintento | UI, jobs de reintento |
| `runAt` | Cuándo se ejecuta job | RetryJob |
| `anchorAt` | Fecha base para notificaciones | SUBSCRIPTION_REMINDER |

---

### Estados de Pago

```
PENDING → Aprobado → APPROVED (cierra ciclo)
        → Rechazado → DECLINED (reintenta)
        → Error → ERROR (reintenta)
        → Anulado → VOIDED (no reintenta)
```

---

### Estados de Suscripción

```
ACTIVE → Corte vencido → PAST_DUE (reintenta)
       → Cancelada → CANCELED (no reintenta)
       → Expirada → EXPIRED (no reintenta)
       → Suspendida → SUSPENDED (no reintenta)
```

---

## 🔧 Configuración Recomendada

```bash
# Débito automático
AUTO_DEBIT_ENABLED=true
AUTO_DEBIT_RETRY_ENABLED=true
AUTO_DEBIT_RETRY_EVERY_MINUTES=60       # Reintenta cada 1h
AUTO_DEBIT_MAX_RETRIES=5                 # 5 intentos totales
AUTO_DEBIT_DISABLED_FALLBACK_LINK=true   # Crea link si falla

# Ventanas de seguridad
DUE_CUTOFF_SCAN_SECONDS=30               # Escanea cada 30s
DUE_CUTOFF_TOLERANCE_SECONDS=30          # Tolerancia de 30s
AUTO_DEBIT_SAFETY_WINDOW_MINUTES=30      # No duplicar en 30min

# Notificaciones
NOTIFICATIONS_CONFIG={"rules":[...]}     # Reglas activas
```

---

## 📋 Checklist de Verificación (10/10)

### Creación de Suscripción
- [ ] Genera referencia única `SUB_{id}_{ciclo}`
- [ ] Crea Payment en BD
- [ ] Crea PaymentLink en Wompi
- [ ] Retorna checkoutUrl
- [ ] Programa notificación SUBSCRIPTION_DUE

### Fecha de Corte
- [ ] `currentPeriodEndAt` calculado correctamente
- [ ] Job `ensureDueCutoffRetries` escanea cada 30s
- [ ] Crea job PAYMENT_RETRY si está vencida
- [ ] Guarda en `metadata.autoRetry.nextRetryAt`
- [ ] **Se muestra en UI** (RetryDateField)

### Reintento de Cobro
- [ ] Valida email del cliente
- [ ] Valida payment source (si AUTO_DEBIT)
- [ ] **Usa `forceNewTransaction: true`**
- [ ] Genera referencia única `SUB_{id}_{ciclo}_R1`
- [ ] Log detallado si falla
- [ ] Fallback a link manual si no hay token

### Webhook de Wompi
- [ ] Verifica firma correctamente
- [ ] Clasifica referencia (SUB_, LINK_, etc.)
- [ ] Actualiza payment status
- [ ] Si APPROVED → actualiza suscripción
- [ ] Si DECLINED → programa reintento
- [ ] Notifica por Chatwoot

### Notificaciones
- [ ] Reglas configuradas activas
- [ ] Calcula offsets correctamente
- [ ] Crea jobs SUBSCRIPTION_REMINDER
- [ ] Renderiza plantilla con datos reales
- [ ] Envía por Chatwoot
- [ ] Log con actor específico

---

## 🔍 Debug de Problemas

### "Referencia duplicada"
```bash
# Ver pagos existentes
curl "https://api.tu-dominio.com/api/payments?subscriptionId=UUID"

# Ver referencias
SELECT reference, status, "createdAt" 
FROM "Payment" 
WHERE "subscriptionId" = 'UUID'
ORDER BY "createdAt" DESC;
```

### "No reintenta"
```bash
# Ver jobs pendientes
curl "https://api.tu-dominio.com/api/logs/notifications/jobs?subscriptionId=UUID"

# Ver configuración
SELECT key, value FROM "Credential" WHERE key LIKE '%AUTO_DEBIT%';
```

### "Webhook no llega"
```bash
# Ver webhooks recibidos
SELECT "eventName", "processStatus", "receivedAt"
FROM "WebhookEvent"
WHERE "tenantId" = 'UUID'
ORDER BY "receivedAt" DESC
LIMIT 20;
```

---

## 📊 Métricas Clave

| Métrica | Ideal | Alerta |
|---------|-------|--------|
| Tasa de aprobación | >85% | <70% |
| Reintentos exitosos | >60% | <40% |
| Tiempo a aprobación | <24h | >72h |
| Fallos por referencia duplicada | 0 | >0 |
| Webhooks procesados | 100% | <95% |

---

## 🎯 Flujo Ideal (Ejemplo Real)

### Día 1: Creación
```
10:00 - Usuario crea suscripción
10:01 - Payment creado: SUB_abc123_1
10:02 - Link de pago enviado por Chatwoot
10:05 - Usuario paga → Webhook APPROVED
10:06 - Suscripción ACTIVE hasta 2026-02-01 10:00
```

### Día 30: Corte
```
09:30 - Job SUBSCRIPTION_REMINDER envía recordatorio
10:00 - currentPeriodEndAt alcanzado
10:01 - Job ensureDueCutoffRetries detecta corte
10:02 - Crea PAYMENT_RETRY job
10:03 - paymentRetry ejecuta
      - Valida email ✅
      - Valida token ✅
      - forceNewTransaction: true ✅
      - Referencia: SUB_abc123_2_R1
10:04 - Wompi procesa transacción
10:05 - Webhook APPROVED
10:06 - Suscripción renovada hasta 2026-03-01 10:00
```

### Si Falla:
```
10:04 - Wompi DECLINED (fondos insuficientes)
10:05 - Webhook procesado
10:06 - Job PAYMENT_RETRY programado para 11:06
10:07 - Chatwoot notifica fallo al cliente
11:06 - Reintento automático (R2)
11:07 - ÉXITO → APPROVED
```

---

## ✅ Esto es lo que necesitas en producción

1. **Aplicar cambio `forceNewTransaction: true`** ✅ (ya hecho)
2. **Verificar configuración AUTO_DEBIT** 
3. **Monitorear logs de paymentRetry**
4. **Verificar que UI muestra fechas de reintento**
