# Revisión y Ajuste de Modales - Ciclos de Pago y Historial

## Cambios Realizados

### 1. **Nuevo Componente Unificado `BillingCyclesModal.tsx`**

Se creó un componente moderno y bien diseñado para mostrar los ciclos de pago de una suscripción.

#### Características Principales:

✅ **Diseño Mejorado**
- Modal con panel fijo y cuerpo con scroll independiente
- Tabla con cabecera sticky para mejor UX
- Overlay con cierre al hacer clic fuera
- Spinner de carga animado
- Estado vacío con ícono y mensaje claro

✅ **Alineación Correcta**
- Todo el texto alineado a la **izquierda** (no centrado)
- Headers y celdas con `textAlign: "left"` explícito
- Solo el ícono de expandir/contraer centrado

✅ **Información Priorizada**
- **Vista principal**: Muestra información legible primero (Ciclo, Período, Fechas, Estado)
- **IDs ocultos**: Los UUIDs solo se muestran en el detalle expandido
- **Nombre del ciclo**: "Ciclo {número}" en lugar de solo "#{número}"

✅ **Detalle Expandible**
Al hacer clic en una fila, se expande mostrando:

**Sección 1 - Información Principal (legible):**
- Plan (nombre completo)
- Estado (con pill de color)
- Puntualidad (con pill de color)
- Razón de asociación
- Origen (con pill)
- Días temprano/tarde (con colores de estado)

**Sección 2 - IDs Técnicos (al final, separados):**
- ID Ciclo (UUID completo, en código gris)
- ID Pago (UUID completo, en código gris)
- ID Suscripción (UUID completo, en código gris)

### 2. **Unificación de Componentes**

Los siguientes componentes ahora son re-exports del mismo componente unificado:
- `BillingCyclesButton.tsx` → Re-exporta `BillingCyclesModal`
- `PaymentCyclesModal.tsx` → Re-exporta `BillingCyclesModal`

### 3. **API Endpoint Actualizado**

`GET /api/billing/billing-cycles?subscriptionId={id}&take=36`

Retorna todos los campos necesarios:
```typescript
{
  id: string;                    // UUID del ciclo
  subscriptionId: string;        // UUID de la suscripción
  cycleNumber: number;           // Número de ciclo (1, 2, 3...)
  periodStartAt: string;         // Inicio del período
  periodEndAt: string;           // Fin del período
  dueAt: string;                 // Fecha de vencimiento
  status: string;                // Estado (PENDING, PAID, FAILED, SKIPPED)
  paidAt: string | null;         // Fecha de pago
  paymentId: string | null;      // UUID del pago asociado
  paidOnTime: boolean | null;    // Si pagó a tiempo
  daysEarly: number | null;      // Días temprano
  daysLate: number | null;       // Días tarde
  origin: string | null;         // Origen del pago
  associationReason: string | null; // Razón de asociación
  subscription: {
    id: string;
    plan: { name: string | null; id: string }
  }
}
```

### 4. **Mejoras de UX**

| Antes | Después |
|-------|---------|
| IDs visibles en la tabla principal | IDs solo en detalle expandido |
| Texto centrado | Todo alineado a la izquierda |
| Diseño básico | Modal moderno con scroll y header sticky |
| Sin separación visual | Secciones claramente diferenciadas |
| IDs con mismo peso visual | IDs secundarizados (gris, más pequeños) |

### 5. **Estilos CSS Aplicados**

```css
/* Alineación izquierda en todas las celdas */
.billing-history-table th,
.billing-history-table td {
  text-align: left;
  vertical-align: middle;
}

/* Headers con estilo */
.billing-history-table th {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  background: var(--panel-soft);
}

/* Pills de estado */
.pill-ok { background: var(--status-ok-soft); color: var(--status-ok); }
.pill-bad { background: var(--status-bad-soft); color: var(--status-bad); }
.pill-warn { background: var(--status-warn-soft); color: var(--status-warn); }
.pill-muted { background: var(--panel-soft); color: var(--text-faint); }
```

## Verificación de Búsquedas

### Campos que se Traen Correctamente:

✅ **Ciclos de Pago:**
- `cycleNumber` → "Ciclo 1", "Ciclo 2", etc.
- `periodStartAt`, `periodEndAt` → Fechas legibles
- `dueAt` → Fecha de vencimiento
- `paidAt` → Fecha de pago
- `status` → Estado con color
- `paidOnTime`, `daysEarly`, `daysLate` → Puntualidad
- `origin` → Origen del pago
- `subscription.plan.name` → Nombre del plan

✅ **IDs (solo en detalle):**
- `id` → UUID del ciclo
- `paymentId` → UUID del pago
- `subscriptionId` → UUID de la suscripción

### Alineación Verificada:

✅ Todo el texto en las tablas está alineado a la **izquierda**
✅ Los nombres/etiquetas legibles van primero
✅ Los IDs/SKUs están ocultos en la vista principal
✅ Los IDs se muestran al final, en sección separada, con estilo secundario

## Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `BillingCyclesModal.tsx` | ⭐ Nuevo componente (337 líneas) |
| `BillingCyclesButton.tsx` | Re-exporta `BillingCyclesModal` |
| `PaymentCyclesModal.tsx` | Re-exporta `BillingCyclesModal` |
| `payments.ts` | Agregado `subscription.id` al include |

## Pruebas Recomendadas

1. Abrir modal de ciclos de pago desde la página de billing
2. Verificar que todo el texto esté alineado a la izquierda
3. Verificar que el nombre del plan sea lo primero que se ve
4. Hacer clic en una fila para expandir detalles
5. Verificar que los IDs aparezcan al final, en sección separada
6. Verificar que el modal tenga scroll cuando hay muchos ciclos
