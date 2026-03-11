# Limpieza de Base de Datos - Instrucciones Completas

## 🔴 Problema

Tienes **pagos huérfanos** (sin suscripción) y **contactos huérfanos** que:
- Ensucian la base de datos
- Causan notificaciones incorrectas
- Consumen recursos innecesariamente
- No tienen match con suscripciones

---

## ✅ Soluciones Disponibles

### 1. Script Automático de Limpieza

**Archivo:** `apps/api/src/scripts/cleanup-database.ts`

**Qué limpia:**
- ✅ Pagos sin suscripción (antiguos, sin transacción Wompi)
- ✅ Contactos sin pagos ni suscripciones
- ✅ Jobs de notificaciones para suscripciones inexistentes
- ✅ Mensajes Chatwoot huérfanos
- ✅ Webhooks procesados (> 30 días)

---

### 2. Endpoint API para Revisar

**Endpoint:** `GET /api/logs/payments/orphaned`

**Respuesta:**
```json
{
  "payments": [
    {
      "id": "uuid",
      "customerId": "uuid",
      "amountInCents": 50000,
      "status": "PENDING",
      "_analysis": {
        "hasActiveSubscriptions": false,
        "hasOtherPayments": false,
        "hasWompiTransaction": false,
        "isApproved": false,
        "recommendedAction": "DELETE",
        "reason": "Huerfano sin transaccion - candidato a eliminar"
      }
    }
  ],
  "summary": {
    "total": 50,
    "keep": 20,
    "delete": 25,
    "review": 5
  }
}
```

**Acciones:**
- `KEEP` → Conservar (tiene suscripciones u otros pagos)
- `DELETE` → Eliminar (huérfano sin valor)
- `REVIEW` → Revisar manualmente (tiene transacción Wompi)

---

## 📋 Pasos para Limpieza

### Paso 1: Analizar (Recomendado)

**Opción A - Desde API:**
```bash
curl "https://tu-dominio.com/api/logs/payments/orphaned?days=30&limit=100"
```

**Opción B - SQL Directo:**
```bash
# Conectar a BD
psql -h <host> -U <user> -d <database>

# Ejecutar análisis
\i apps/api/scripts/sql/analyze-orphan-payments.sql
```

**Opción C - Script Dry-Run:**
```bash
cd apps/api
npx tsx src/scripts/cleanup-database.ts --dry-run --days=30
```

---

### Paso 2: Ejecutar Limpieza

**En Producción (PM2):**
```bash
# Dry-run primero
pm2 exec 0 "npx tsx apps/api/src/scripts/cleanup-database.ts --dry-run"

# Limpieza real
pm2 exec 0 "npx tsx apps/api/src/scripts/cleanup-database.ts --days=30"
```

**En Local:**
```bash
cd apps/api
npx tsx src/scripts/cleanup-database.ts --days=30
```

---

### Paso 3: Verificar Resultados

El script muestra:
```
📊 RESUMEN:
═══════════════════════════════════════
Pagos huerfanos:
  - Escaneados: 150
  - Eliminados: 85
  - Conservados: 65
  - Razones:
    • cliente_tiene_suscripciones: 30
    • cliente_tiene_otros_pagos: 20
    • pago_aprobado_historico: 15

Contactos huerfanos:
  - Escaneados: 50
  - Eliminados: 30
  - Conservados: 20

Jobs huerfanos:
  - Escaneados: 200
  - Eliminados: 180

Mensajes Chatwoot huerfanos:
  - Escaneados: 75
  - Eliminados: 60

Webhooks antiguos:
  - Escaneados: 500
  - Eliminados: 500

═══════════════════════════════════════
🎯 TOTAL ELIMINADO: 855 registros
```

---

## 🎯 Criterios de Eliminación

### Pagos - ELIMINAR si:
- ❌ `subscriptionId` es NULL
- ❌ `wompiTransactionId` es NULL (no se procesó)
- ❌ `status` es PENDING/DECLINED/ERROR
- ❌ `createdAt` > 30 días (configurable)
- ❌ Cliente NO tiene suscripciones
- ❌ Cliente NO tiene otros pagos

### Pagos - CONSERVAR si:
- ✅ `status` es APPROVED (histórico válido)
- ✅ `wompiTransactionId` existe (se procesó)
- ✅ Cliente tiene suscripciones activas
- ✅ Cliente tiene otros pagos

### Contactos - ELIMINAR si:
- ❌ NO tiene pagos
- ❌ NO tiene suscripciones
- ❌ NO tiene mensajes Chatwoot
- ❌ NO tiene email (no es lead válido)
- ❌ NO está en smart lists

---

## 🔍 Identificar Pagos Sin Match

### Caso 1: Pago con Transacción Wompi pero Sin Suscripción

```sql
SELECT 
  p.id,
  p."customerId",
  p."amountInCents",
  p."wompiTransactionId",
  p."reference",
  p.status,
  c.email,
  'POSIBLE_MATCH_MANUAL' as accion
FROM "Payment" p
LEFT JOIN "Customer" c ON c.id = p."customerId"
WHERE p."subscriptionId" IS NULL
  AND p."wompiTransactionId" IS NOT NULL
  AND p.status = 'APPROVED'
ORDER BY p."createdAt" DESC;
```

**Acción:** Asignar manualmente a suscripción existente o crear nueva.

---

### Caso 2: Pago Aprobado Sin Transacción

```sql
SELECT 
  p.id,
  p."customerId",
  p."amountInCents",
  p."reference",
  c.email,
  'REVISAR_REFERENCIA' as accion
FROM "Payment" p
LEFT JOIN "Customer" c ON c.id = p."customerId"
WHERE p."subscriptionId" IS NULL
  AND p.status = 'APPROVED'
  AND p."wompiTransactionId" IS NULL
ORDER BY p."createdAt" DESC;
```

**Acción:** Verificar referencia en Wompi dashboard.

---

### Caso 3: Pago Pendiente Antiguo

```sql
SELECT 
  p.id,
  p."customerId",
  p."amountInCents",
  p."createdAt",
  c.email,
  'ELIMINAR' as accion
FROM "Payment" p
LEFT JOIN "Customer" c ON c.id = p."customerId"
WHERE p."subscriptionId" IS NULL
  AND p.status IN ('PENDING', 'DECLINED', 'ERROR')
  AND p."wompiTransactionId" IS NULL
  AND p."createdAt" < NOW() - INTERVAL '30 days'
ORDER BY p."createdAt" ASC;
```

**Acción:** Eliminar (ya no es válido).

---

## 🛡️ Seguridad

### El script NUNCA elimina:
1. Pagos aprobados (histórico)
2. Pagos con transacción Wompi (se procesaron)
3. Contactos con email (leads válidos)
4. Contactos con suscripciones activas
5. Jobs para suscripciones existentes

### El script SIEMPRE registra:
- Log en `SystemLog` con `actor: "script:database-cleanup"`
- Resumen detallado de qué se eliminó y por qué

---

## 📅 Frecuencia Recomendada

| Tipo | Frecuencia | Comando |
|------|------------|---------|
| **Limpieza ligera** | Semanal | `--days=7` |
| **Limpieza completa** | Mensual | `--days=30` |
| **Limpieza profunda** | Trimestral | `--days=90` |

---

## 🚨 Posibles Problemas y Soluciones

### "Eliminé un pago que no debía"

**Solución:** Los pagos eliminados NO se pueden recuperar. Siempre hacer dry-run primero.

```bash
npx tsx apps/api/src/scripts/cleanup-dleanup-database.ts --dry-run --days=30
```

### "Hay pagos con transacción Wompi que no tienen match"

**Solución:** Revisar manualmente y asignar:

```sql
-- Ver pagos con transacción sin suscripción
SELECT * FROM "Payment"
WHERE "subscriptionId" IS NULL
  AND "wompiTransactionId" IS NOT NULL;

-- Asignar manualmente (si conoces la suscripción)
UPDATE "Payment"
SET "subscriptionId" = 'uuid-de-suscripcion'
WHERE id = 'uuid-del-pago';
```

### "Contactos eliminados aparecen en Chatwoot"

**Solución:** Los contactos en Chatwoot son independientes. Sincronizar:

```bash
npx tsx apps/api/src/scripts/sync-chatwoot-contacts.ts
```

---

## 📊 Monitoreo Post-Limpieza

### Verificar que no haya errores:

```bash
# Logs de PM2
pm2 logs crm-sus-jobs --lines 50

# Ver SystemLog
curl "https://tu-dominio.com/api/logs/system?q=database.cleanup"
```

### Verificar espacio recuperado:

```sql
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## ✅ Checklist de Limpieza

- [ ] Ejecutar dry-run (`--dry-run`)
- [ ] Revisar resumen de eliminación
- [ ] Verificar pagos con `REVIEW` manualmente
- [ ] Ejecutar limpieza real
- [ ] Verificar logs de sistema
- [ ] Confirmar espacio recuperado
- [ ] Programar próxima limpieza

---

## 📞 Soporte

Si hay dudas sobre qué eliminar:

1. **Revisar endpoint:** `GET /api/logs/payments/orphaned`
2. **Ejecutar SQL:** `analyze-orphan-payments.sql`
3. **Dry-run:** Ver qué se eliminaría
4. **Consultar logs:** `GET /api/logs/system?q=cleanup`
