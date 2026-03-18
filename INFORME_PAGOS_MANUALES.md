# Informe: Error en Pagos Manuales - Análisis y Solución

## Fecha: 10 de marzo de 2026

## Problema
Los pagos manuales desde el panel fallaban sin explicación clara.

## Causa Raíz

Cuando se hacía un **cobro manual**:
1. Webhook de Wompi llegaba con referencia `SUB_{subscriptionId}_{ciclo}`
2. El sistema no encontraba el payment (aún no existía)
3. **En lugar de usar el subscriptionId de la referencia**, intentaba inferir por email/teléfono
4. Si había **múltiples suscripciones con mismo precio** → "ambigüedad" → webhook fallaba
5. El pago quedaba huérfano

## Solución

### 1. processWompiEvent.ts - Usar referencia directamente
```typescript
// FIX: Si la referencia es SUB_xxx_cycle, usar subscriptionId de la referencia
// La inferencia por identidad SOLO para referencias desconocidas
const hasStructuredReference = referenceClassification.kind === "subscription" && referenceClassification.subscriptionId;

if (!hasStructuredReference) {
  // Solo inferir por identidad si NO hay referencia estructurada
  const inferred = await inferSubscriptionByCustomerIdentity();
}
```

### 2. processWompiEvent.ts - Asignar suscripción en fallback
```typescript
// FIX: Si hay referencia estructurada SUB_xxx, asignar la suscripción
let fallbackSubscriptionId: string | null = null;
if (referenceClassification.kind === "subscription" && referenceClassification.subscriptionId) {
  const subFromRef = await db.subscription.findUnique({
    where: { id: referenceClassification.subscriptionId }
  });
  if (subFromRef) {
    fallbackSubscriptionId = subFromRef.id;
    fallbackCustomerId = subFromRef.customerId;
  }
}
```

### 3. ReconcilePaymentModal.tsx - Validación cliente
- Validación de campos requeridos
- Mensajes de error claros

### 4. logs.ts - Errores descriptivos
- Mensajes específicos por cada tipo de error

## Archivos Modificados
- `packages/core/src/jobs/handlers/processWompiEvent.ts`
- `apps/admin/app/logs/ReconcilePaymentModal.tsx`
- `packages/core/src/routes/logs.ts`
- `vitest.config.ts`

## Resultado
✅ Pagos manuales ahora funcionan correctamente
✅ Pagos se asignan a suscripción correcta
✅ Sin ambigüedad
✅ Errores descriptivos
