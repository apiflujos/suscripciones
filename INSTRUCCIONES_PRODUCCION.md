# Instrucciones de Despliegue - Trazabilidad Completa

## ✅ Cambios Realizados

### 1. Trazabilidad de Actor
- Campo `actor` en `SystemLog` y `ChatwootMessage`
- Actores específicos: `job:subscriptionReminder`, `webhook:wompi`, `job:sendChatwootMessage`, etc.

### 2. Fecha de Reintento Visible
- Componente `RetryDateField` en billing
- Endpoint `POST /api/subscriptions/:id/set-retry-date`
- Guarda en `metadata.manualRetry.nextRetryAt`

### 3. Jobs Transparentes
- `ensureDueCutoffRetries` ahora guarda fechas en `metadata.autoRetry`
- Endpoint `GET /api/logs/notifications/jobs` para ver jobs pendientes

### 4. Limpieza de Jobs Huérfanos
- Script `cleanup-orphan-notification-jobs.ts`

---

## 📋 Pasos para Producción

### 1. Aplicar Migración de Prisma

```bash
cd /path/to/wompi_subs/apps/api

# Aplicar migración
npx prisma migrate deploy

# Verificar
npx prisma db seed --help
```

**La migración agrega:**
- Columna `actor` en `SystemLog`
- Columna `actor` en `ChatwootMessage`
- Índices para consultas eficientes

---

### 2. Reiniciar PM2

```bash
# Reiniciar todos los procesos
pm2 restart all

# O reiniciar selectivamente
pm2 restart crm-sus-api-<cliente>
pm2 restart crm-sus-jobs-<cliente>
```

---

### 3. Limpiar Jobs Huérfanos (Opcional pero Recomendado)

```bash
# Ejecutar script de limpieza
pm2 exec 0 "npx tsx apps/api/src/scripts/cleanup-orphan-notification-jobs.ts"
```

**Esto eliminará:**
- Jobs de suscripciones canceladas/expiradas
- Jobs con ciclos desactualizados
- Jobs > 7 días

---

### 4. Verificar en Frontend

1. **Ir a `/billing`**
2. **Verificar que las tarjetas muestran:**
   - Fecha de corte
   - Fecha de reintento (si existe)
   - Botón ✏️ para editar fecha de reintento

3. **Probar edición de fecha:**
   - Click en ✏️
   - Seleccionar fecha/hora
   - Guardar
   - Verificar que se actualiza

---

## 🔍 Comandos de Debug

### Ver jobs pendientes de un cliente
```bash
curl "https://api.tu-dominio.com/api/logs/notifications/jobs?customerId=UUID_CLIENTE"
```

### Ver jobs de una suscripción
```bash
curl "https://api.tu-dominio.com/api/logs/notifications/jobs?subscriptionId=UUID_SUSCRIPT"
```

### Establecer fecha de reintento manual
```bash
curl -X POST "https://api.tu-dominio.com/api/subscriptions/UUID/set-retry-date" \
  -H "Content-Type: application/json" \
  -d '{
    "nextRetryAt": "2026-03-15T10:00:00Z",
    "actorEmail": "admin@empresa.com"
  }'
```

### Limpiar fecha de reintento
```bash
curl -X POST "https://api.tu-dominio.com/api/subscriptions/UUID/set-retry-date" \
  -H "Content-Type: application/json" \
  -d '{"nextRetryAt": null}'
```

---

## 📊 Ver Logs en Frontend

1. **Ir a `/logs`**
2. **Columna "Actor" ahora muestra:**
   - `job:subscriptionReminder` - Notificaciones automáticas
   - `webhook:wompi` - Webhooks de Wompi
   - `job:sendChatwootMessage` - Envío de mensajes
   - `usuario@empresa.com` - Acciones manuales
   - `Sistema` - Acciones genéricas

3. **Click en "Ver" para ver contexto completo:**
   - `subscriptionId`
   - `currentPeriodEndAt`
   - `rulesCount`
   - `offsetSeconds`
   - `anchorAt`

---

## ⚙️ Configuración Recomendada

### Variables de Entorno

```bash
# Hacer jobs transparentes (ya está implementado)
AUTO_DEBIT_CHARGE_AT_CUTOFF_ENABLED=true

# Espaciado de reintentos
AUTO_DEBIT_RETRY_EVERY_MINUTES=1440

# Tolerancia para cutoff (segundos)
DUE_CUTOFF_TOLERANCE_SECONDS=30

# Frecuencia de escaneo de cutoff
DUE_CUTOFF_SCAN_SECONDS=30
```

---

## 🎯 Flujo de Trabajo Recomendado

### Cuando un Cliente Reporta Cobro Inesperado

1. **Verificar jobs pendientes:**
   ```bash
   curl "https://api.tu-dominio.com/api/logs/notifications/jobs?customerId=UUID"
   ```

2. **Revisar logs:**
   - Ir a `/logs`
   - Filtrar por actor `job:subscriptionReminder` o `webhook:wompi`
   - Ver contexto para ver `currentPeriodEndAt` y `anchorAt`

3. **Si hay fecha incorrecta:**
   - Ir a `/billing`
   - Buscar suscripción del cliente
   - Click en ✏️ en "Fecha de reintento"
   - Establecer nueva fecha o limpiar

4. **Si hay jobs huérfanos:**
   ```bash
   pm2 exec 0 "npx tsx apps/api/src/scripts/cleanup-orphan-notification-jobs.ts"
   ```

---

## 📝 Notas Importantes

1. **Fechas manuales tienen prioridad:** Si `metadata.manualRetry.nextRetryAt` existe y es futura, `ensureDueCutoffRetries` no crea jobs automáticos.

2. **Jobs automáticos son transparentes:** Ahora se guardan en `metadata.autoRetry.nextRetryAt` y son visibles en el frontend.

3. **Actor en logs:** Todas las acciones ahora quedan registradas con el actor específico para trazabilidad completa.

4. **Limpieza periódica:** Se recomienda ejecutar el script de limpieza semanalmente para evitar acumulación de jobs huérfanos.

---

## ✅ Checklist de Verificación

- [ ] Migración aplicada (`npx prisma migrate deploy`)
- [ ] PM2 reiniciado (`pm2 restart all`)
- [ ] Jobs huérfanos limpiados (opcional)
- [ ] Frontend muestra fecha de reintento en `/billing`
- [ ] Se puede editar fecha de reintento
- [ ] Logs muestran columna "Actor"
- [ ] Endpoint `/api/logs/notifications/jobs` responde correctamente

---

## 🆘 Soporte

Si hay problemas:

1. **Ver logs de PM2:**
   ```bash
   pm2 logs crm-sus-api-<cliente> --lines 100
   pm2 logs crm-sus-jobs-<cliente> --lines 100
   ```

2. **Verificar migración:**
   ```bash
   npx prisma migrate status
   ```

3. **Revisar jobs en BD:**
   ```sql
   SELECT type, status, count(*) 
   FROM "RetryJob" 
   GROUP BY type, status;
   ```
