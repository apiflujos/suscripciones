# 🚀 QUICK START - ApiFlujos UI System

## ¿Qué Cambió?

### ANTES ❌
```tsx
// Cada vista tenía su propia implementación
<button style={{ height: 32, background: '#6B4FE0' }}>
  Guardar
</button>

<span style={{ padding: '4px 12px', background: '#e1f5ee', color: '#085041' }}>
  Activo
</span>

<input style={{ height: 24, border: '1px solid #e5e5e5' }} />
```

**Problemas:**
- ❌ Alturas inconsistentes (20px, 24px, 32px)
- ❌ Colores hardcoded (#6B4FE0, #e1f5ee)
- ❌ Sin reutilización de código
- ❌ Difícil mantenimiento

### AHORA ✅
```tsx
// Componentes canónicos reutilizables
import { Button, Badge, Input } from '@/app/ui';

<Button variant="primary">Guardar</Button>
<Badge variant="success">Activo</Badge>
<Input />
```

**Ventajas:**
- ✅ Alturas consistentes (36px buttons, 20px badges)
- ✅ Colores con tokens (--brand, --success-light)
- ✅ 100% reutilizable
- ✅ Fácil mantenimiento

## 📦 Instalación

Los componentes ya están disponibles en `@/app/ui`. Solo importa:

```tsx
import { Button, Badge, Input } from '@/app/ui';
```

## 🎯 Componentes Disponibles

| Componente | Uso | Altura |
|------------|-----|--------|
| `<Button>` | Acciones | 36px (md), 28px (sm), 40px (lg) |
| `<Badge>` | Estados | 20px (siempre) |
| `<Input>` | Formularios | 36px (siempre) |
| `<Select>` | Dropdowns | 36px (siempre) |
| `<Toolbar>` | Filtros | Auto |
| `<MetricCard>` | KPIs | Auto |
| `<EntityCard>` | Empresas/Productos | Auto |
| `<ListRow>` | Listas | 48px (siempre) |
| `<SubscriptionRow>` | Suscripciones | Auto |
| `<PageHeader>` | Títulos | Auto |
| `<Tabs>` | Navegación | Auto |

## 🎨 Ejemplos Rápidos

### Button
```tsx
<Button variant="primary">Guardar</Button>
<Button variant="secondary">Cancelar</Button>
<Button variant="danger" size="sm">Eliminar</Button>
```

### Badge
```tsx
<Badge variant="success">Activo</Badge>
<Badge variant="danger">Vencido</Badge>
<Badge variant="warning">Pendiente</Badge>
```

### Input
```tsx
<Input 
  label="Email" 
  placeholder="correo@ejemplo.com"
  error={!!errors.email}
  errorText={errors.email}
/>
```

## 📚 Documentación

- **Completa:** `UI_STANDARDIZATION.md`
- **Ejemplos:** `MIGRACION_VISTAS_EJEMPLO.md`
- **UI README:** `apps/admin/app/ui/README.md`

## ⚠️ Importante

- ✅ **Código legacy SIGUE FUNCIONANDO** (`.pill`, `.btn`)
- ✅ **Nueva código usa componentes** (`<Badge>`, `<Button>`)
- ✅ **Cero ruptura en producción**

---

**¿Listo?** Empezá a usar los componentes nuevos en tu próximo PR.
