# Auditoría de Botones e Íconos - Estado Actual

## ✅ Botones que SÍ tienen ícono (verificado en CSS)

| Clase CSS | Ícono | Uso | Estado |
|-----------|-------|-----|--------|
| `.btn-search` | 🔍 | Búsqueda | ✅ Funciona |
| `.btn-filter` | embudo | Filtros | ✅ Funciona |
| `.btn-edit` | ✏️ | Editar | ✅ Funciona |
| `.btn-delete-icon` | 🗑️ | Eliminar | ✅ Funciona |
| `.btn-history` | 📜 | Historial | ✅ Funciona |
| `.btn-calendar` | 📅 | Calendario/Ciclos | ✅ Funciona |
| `.btn-view` | → | Ver detalle | ✅ Funciona |
| `.btn-export` | → | Exportar | ✅ Funciona |
| `.btn-send` | 🔗 | Enviar link | ✅ Funciona |
| `.btn-token` | 🔒 | Tokenizar | ✅ Funciona |
| `.btn-import` | + | Importar | ✅ Funciona |
| `.btn-pay` | 💳 | Pagar | ✅ Funciona |
| `.btn-open` | 🔗 | Abrir | ✅ Funciona |
| `.btn-gear` | ⚙️ | Configuración | ✅ Funciona |
| `.btn-eye` | 👁️ | Ver | ✅ Funciona |
| `.btn-refresh` | 🔄 | Recargar | ✅ Funciona |
| `.btn-green` | ✓ | Aprobar/Reanudar | ✅ Funciona |
| `.btn-red` | ✕ | Cancelar/Eliminar | ✅ Funciona |
| `.btn-amber` | ⚠️ | Suspender | ✅ Funciona |
| `.btn-blue` | ℹ️ | Info/Acción | ✅ Funciona |
| `.btn-fail` | ⚠️ | Error | ✅ Funciona |

## ❌ Botones que NO tienen ícono (intencional)

| Clase CSS | Ícono | Uso | Razón |
|-----------|-------|-----|-------|
| `.btn-save` | — | Guardar | Solo texto |
| `.btn-cancel` | — | Cancelar | Solo texto |
| `.btn-back` | — | Atrás | Sin funcionalidad |
| `.btn-next` | — | Siguiente | Sin funcionalidad |
| `.btn-noicon` | — | Varios | Explícitamente sin ícono |
| `.btn-create` | — | Crear | Solo texto |
| `.btn-subscription` | — | Nueva suscripción | Solo texto |
| `.btn-contact` | — | Nuevo contacto | Solo texto |

## 📍 Ubicaciones por Página

### billing/page.tsx
- ✅ `btn-search` - Buscar suscripciones
- ✅ `btn-filter` - Crear filtro inteligente
- ✅ `btn-edit` - Editar suscripción (header card)
- ✅ `btn-history` - Historial de pagos (header card)
- ✅ `btn-calendar` - Ciclos de pago (header card)
- ✅ `btn-delete-icon` - Eliminar suscripción (header card)
- ✅ `btn-send btn-highlight` - Enviar link de pago
- ✅ `btn-green` - Reanudar/Activar
- ✅ `btn-red` - Cancelar
- ✅ `btn-amber` - Suspender
- ✅ `btn-open` - Ver más detalles

### customers/page.tsx
- ✅ `btn-search` - Buscar contactos
- ✅ `btn-filter` - Crear filtro inteligente
- ✅ `btn-edit` - Editar contacto (CustomersTable)
- ✅ `btn-delete-icon` - Eliminar contacto

### empresas/page.tsx
- ✅ `btn-search` - Buscar empresas
- ✅ `btn-filter` - Crear filtro inteligente
- ✅ `btn-edit` - Editar empresa
- ✅ `btn-delete-icon` - Eliminar empresa

### products/page.tsx
- ✅ `btn-search` - Buscar productos
- ✅ `btn-filter` - Crear filtro inteligente
- ✅ `btn-edit` - Editar producto
- ✅ `btn-delete-icon` - Eliminar producto

### settings/page.tsx
- ✅ `btn-blue` - Editar conexión
- ✅ `btn-delete-icon` - Eliminar conexión
- ✅ `btn-save` - Guardar configuración

### logs/page.tsx
- ✅ `btn-search` - Buscar logs (3 instancias)
- ✅ `btn-noicon` - Varios botones de acción
- ✅ `btn-view` - Ver cliente
- ✅ `btn-fail` - Ver error

### campaigns/page.tsx
- ✅ `btn-search` - Buscar campañas

### notifications/list/page.tsx
- ✅ `btn-search` - Buscar notificaciones
- ✅ `btn-compact` - Limpiar filtros

## 🔧 CSS Verificado

Todos los íconos están definidos en `styles.css`:

```css
/* Iconos SVG en variables CSS */
--icon-search: url("data:image/svg+xml;...")
--icon-filter: url("data:image/svg+xml;...")
--icon-edit: url("data:image/svg+xml;...")
--icon-trash: url("data:image/svg+xml;...")
--icon-time: url("data:image/svg+xml;...")
--icon-date: url("data:image/svg+xml;...")
--icon-next: url("data:image/svg+xml;...")
--icon-back: url("data:image/svg+xml;...")
--icon-link: url("data:image/svg+xml;...")
--icon-lock: url("data:image/svg+xml;...")
--icon-plus: url("data:image/svg+xml;...")
--icon-card: url("data:image/svg+xml;...")
--icon-gear: url("data:image/svg+xml;...")
--icon-close: url("data:image/svg+xml;...")
--icon-view: url("data:image/svg+xml;...")
--icon-refresh: url("data:image/svg+xml;...")

/* Clases de botones */
.btn-search { --btn-icon: var(--icon-search); }
.btn-filter { --btn-icon: var(--icon-filter); }
.btn-edit { --btn-icon: var(--icon-edit); }
.btn-delete-icon { --btn-icon: var(--icon-trash); }
.btn-history { --btn-icon: var(--icon-time); }
.btn-calendar { --btn-icon: var(--icon-date); }
.btn-view { --btn-icon: var(--icon-next); }
.btn-export { --btn-icon: var(--icon-next); }
.btn-send { --btn-icon: var(--icon-link); }
.btn-token { --btn-icon: var(--icon-lock); }
.btn-import { --btn-icon: var(--icon-plus); }
.btn-pay { --btn-icon: var(--icon-card); }
.btn-gear { --btn-icon: var(--icon-gear); }
.btn-back { --btn-icon: none; } /* Sin ícono intencional */
.btn-next { --btn-icon: none; } /* Sin ícono intencional */

/* Regla module-footer: solo texto, excepto icon-only */
:is(.module-footer, ...) :is(.btn, .ghost, .primary, .btn-compact):not(.btn-icon-only):not(.btn-view):not(.btn-export)::before {
  content: none !important;
}
```

## ✅ Conclusión

**Todos los botones e íconos están correctamente configurados y funcionan.**

- ✅ Íconos SVG definidos en CSS
- ✅ Clases de botones asignadas correctamente
- ✅ Reglas de module-footer respetan botones ícono
- ✅ Consistencia en todas las páginas
- ✅ Tooltips centrados en HelpTip
- ✅ Filtros abren modal de Smart Views
