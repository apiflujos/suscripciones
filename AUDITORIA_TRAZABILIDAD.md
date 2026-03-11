# Auditoría de Trazabilidad - Notificaciones y Pagos

## Problemas Identificados

### 1. Notificaciones a horas inesperadas (9:30 PM)

**Causa raíz:** Las notificaciones se programan basadas en `currentPeriodEndAt` de cada suscripción. Si una suscripción se creó o modificó a las 9:30 PM, sus notificaciones recurrentes se dispararán a esa hora.

**Flujo actual:**
```
Suscripción creada → currentPeriodEndAt = 2026-03-10 21:30:00
→ Notificación programada para 1 día antes a las 21:30:00
→ Job se ejecuta → Notificación enviada
```

**Solución implementada:**
- Ahora todos los logs incluyen el campo `actor` con valores específicos:
  - `job:subscriptionReminder` - Notificaciones automáticas programadas
  - `webhook:wompi` - Acciones desde webhooks de Wompi
  - `job:sendChatwootMessage` - Envío de mensajes a Chatwoot
  - `usuario@empresa.com` - Acciones manuales de usuarios

### 2. Logs no muestran origen específico

**Antes:**
```
Actor: "Sistema"
Mensaje: "Notificaciones programadas"
```

**Ahora:**
```
Actor: "job:subscriptionReminder"
Mensaje: "Notificaciones programadas"
Contexto: { trigger: "SUBSCRIPTION_DUE", subscriptionId: "...", ruleId: "..." }
```

### 3. Conexión Sandbox se cierra al probar

**Problema:** En `ConnectionsPanel.tsx`, el estado de la prueba de conexión (`wompiTestStatus`) se mantiene, pero la UI no lo preserva correctamente después de cerrar el modal.

**Causa:** El estado local `wompiTestStatus` está indexado por `PRODUCTION`/`SANDBOX`, pero la UI solo muestra el check si el modal está abierto.

### 4. Badge "Listo" debería ser check verde sin texto

**Problema:** Las conexiones muestran `<span className="pill pill-ok pill-sm">Listo</span>`

**Solución:** Cambiar a solo un ícono de check verde.

---

## Flujo Completo de Notificaciones

### Trigger: SUBSCRIPTION_DUE

1. **Origen:** Job scheduler (`jobs/runner.ts`)
2. **Actor:** `job:subscriptionReminder`
3. **Cuándo:** Basado en `currentPeriodEndAt` + offsets de la regla
4. **Logs creados:**
   - `notifications.schedule` - Cuando se programa
   - `notifications.dispatch` - Cuando se procesa
   - `notifications.render` - Cuando se renderiza plantilla
   - `chatwoot.send` - Cuando se envía a Chatwoot

### Trigger: PAYMENT_APPROVED / PAYMENT_DECLINED

1. **Origen:** Webhook de Wompi (`processWompiEvent.ts`)
2. **Actor:** `webhook:wompi`
3. **Cuándo:** Cuando Wompi notifica cambio de estado
4. **Logs creados:**
   - `webhooks.wompi` - Webhook recibido
   - `notifications.payment_status` - Notificaciones programadas
   - `chatwoot.sync` - Sincronización de atributos

### Trigger: Manual (API)

1. **Origen:** Routes (`routes/notifications.ts`, `routes/subscriptions.ts`)
2. **Actor:** Email del usuario o `"Sistema"`
3. **Cuándo:** Cuando usuario crea/edita suscripción
4. **Logs creados:** Depende de la acción

---

## Mejoras de Trazabilidad Implementadas

### Base de Datos

```prisma
model SystemLog {
  actor     String?  // Nuevo campo
  // ... resto de campos
}

model ChatwootMessage {
  actor     String?  // Nuevo campo
  // ... resto de campos
}
```

### Actores Específicos

| Actor | Descripción |
|-------|-------------|
| `job:subscriptionReminder` | Job de recordatorio de suscripciones |
| `job:sendChatwootMessage` | Job de envío de mensajes Chatwoot |
| `job:processWompiEvent` | Job de procesamiento de webhooks |
| `webhook:wompi` | Webhook entrante de Wompi |
| `Sistema` | Acciones genéricas del sistema |
| `usuario@empresa.com` | Acción manual de usuario |

---

## Próximos Pasos

1. **Aplicar migración:** `npx prisma migrate deploy`
2. **Reiniciar PM2:** `pm2 restart all`
3. **Monitorear logs:** Verificar que ahora se ve el actor específico
4. **Fix UI Sandbox:** Actualizar `ConnectionsPanel.tsx`
5. **Fix Badge "Listo":** Cambiar a check verde sin texto
