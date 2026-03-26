# UI/UX Standardization — ApiFlujos Design System v3.0

## Overview

This document describes the complete UI standardization implemented across the ApiFlujos platform. All components now follow a strict design token system to ensure consistency, accessibility, and maintainability.

## 🎯 Design Tokens

All UI values are now defined in `/apps/admin/app/ui/design-tokens.css`.

### Spacing (multiples of 4px)

| Token | Value | Usage |
|-------|-------|-------|
| `--sp1` | 4px | Micro gaps, icon spacing |
| `--sp2` | 8px | Inline gaps, badge gaps |
| `--sp3` | 12px | Column gaps, small padding |
| `--sp4` | 16px | Card padding (default) |
| `--sp5` | 20px | Section gaps |
| `--sp6` | 24px | Major section separation |
| `--sp7` | 28px | Intermediate spacing |
| `--sp8` | 32px | Module-level separation |
| `--sp9` | 36px | Large spacing |
| `--sp10` | 40px | Extra large spacing |
| `--sp12` | 48px | Section separation |
| `--sp16` | 64px | Page-level separation |

### Component Heights (FIXED - no exceptions)

| Token | Value | Usage |
|-------|-------|-------|
| `--h-input` | 36px | Inputs, selects, date inputs |
| `--h-btn` | 36px | Buttons (default/md) |
| `--h-btn-sm` | 28px | Small buttons |
| `--h-btn-lg` | 40px | Large buttons |
| `--h-row` | 48px | List/table rows |
| `--h-badge` | 20px | Badges, pills, tags |
| `--h-action-btn` | 28px | Icon/action buttons |
| `--h-avatar` | 28px | Avatar circles |

### Typography (ONLY these sizes allowed)

| Token | Size/Weight/Line | Usage |
|-------|-----------------|-------|
| `--text-meta` | 12px/400/1.4 | Metadata, timestamps |
| `--text-label` | 11px/500/1 | Labels (uppercase + 0.06em spacing) |
| `--text-body` | 13px/400/1.5 | Body text, cards |
| `--text-card-header` | 13px/500/1.5 | Card titles |
| `--text-section-title` | 16px/500/1.4 | Section titles |
| `--text-page-title` | 20px/500/1.3 | Page titles |
| `--text-metric-lg` | 22px/500/1.2 | Main metrics |
| `--text-metric-sm` | 18px/500/1.2 | Sub-metrics |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Action buttons, tags |
| `--radius-md` | 8px | Inputs, selects, small cards |
| `--radius-lg` | 10px | All cards, modals, panels |
| `--radius-pill` | 10px | Badges (always) |

### Colors (Approved palette only)

#### Brand
- `--brand`: #6B4FE0 (primary)
- `--brand-hover`: #5A3FCC
- `--brand-light`: #EDE9FF
- `--brand-text`: #3C3489

#### Semantic
- `--success`: #1D9E75 / `--success-light`: #E1F5EE / `--success-text`: #085041
- `--danger`: #E24B4A / `--danger-light`: #FCEBEB / `--danger-text`: #791F1F
- `--warning`: #BA7517 / `--warning-light`: #FAEEDA / `--warning-text`: #633806

#### Gray Scale
- `--gray-50`: #F7F7F6
- `--gray-100`: #EDEDEB
- `--gray-200`: #D3D1C7
- `--gray-400`: #888780
- `--gray-600`: #5F5E5A
- `--gray-900`: #1A1A19

### Icons

| Token | Value | Usage |
|-------|-------|-------|
| `--icon-xs` | 14px | Inline with text |
| `--icon-sm` | 16px | Inside buttons |
| `--icon-md` | 20px | Standalone contextual |
| `--icon-lg` | 24px | Featured icons |
| `--icon-action` | 28px | Action button container |
| `--icon-metric` | 28px | Metric card icon |

**Rule:** NEVER render an icon above 28px inside a data/UI component.

## 🧩 Canonical Components

All components are located in `/apps/admin/app/ui/` and must be used across all views.

### Import

```typescript
import { 
  Button, Badge, Input, Select, 
  Toolbar, MetricCard, EntityCard, 
  ListRow, SubscriptionRow, PageHeader, Tabs 
} from '@/app/ui';
```

### 1. `<Button>`

**Variants:** `primary` | `secondary` | `danger` | `ghost` (NO others)

**Sizes:** `sm` (28px) | `md` (36px) | `lg` (40px) | `icon` (28×28px)

```tsx
<Button variant="primary" size="md">
  Click me
</Button>

<IconButton leftIcon={<svg />}>
  {/* Icon only */}
</IconButton>
```

### 2. `<Badge>`

**Variants:** `success` | `danger` | `warning` | `info` | `neutral` (NO others)

**Height:** Always 20px

```tsx
<Badge variant="success">Activa</Badge>
<Badge variant="danger">Vencida</Badge>
<Badge variant="warning">Suspendida</Badge>
<Badge variant="info">Canal</Badge>
<Badge variant="neutral">Sin tarjeta</Badge>
```

### 3. `<Input>` / `<Select>`

**Height:** Always 36px

```tsx
<Input 
  label="Email" 
  placeholder="correo@ejemplo.com"
  error={!!errors.email}
  errorText={errors.email}
/>

<Select 
  label="Estado"
  options={[
    { value: 'active', label: 'Activo' },
    { value: 'inactive', label: 'Inactivo' }
  ]}
/>
```

### 4. `<Toolbar>`

**Structure:** Search | Filters | Actions (in this exact order)

```tsx
<Toolbar>
  <ToolbarSearch placeholder="Buscar..." />
  <ToolbarDivider />
  <ToolbarFilters>
    <Select options={...} />
  </ToolbarFilters>
  <ToolbarActions>
    <Button variant="primary">Nuevo</Button>
  </ToolbarActions>
</Toolbar>
```

### 5. `<MetricCard>`

**Grid:** 3 columns desktop, 2 tablet, 1 mobile

```tsx
<MetricGrid>
  <MetricCard
    label="Ingresos Totales"
    value="$12,450,000"
    sub="Ticket promedio: $85,000"
    delta={12.5}
    icon={<svg />}
    iconBg="success"
  />
  {/* More cards... */}
</MetricGrid>
```

### 6. `<EntityCard>`

**Grid:** 3 columns desktop, 2 tablet, 1 mobile

```tsx
<EntityGrid>
  <EntityCard
    title="Empresa SAS"
    subtitle="empresa@email.com"
    footer={
      <>
        <Badge variant="neutral">5 contactos</Badge>
        <Button variant="secondary" size="sm">Ver detalle</Button>
      </>
    }
  >
    <div className="entity-card-meta">
      <div className="entity-card-meta-key">Teléfono</div>
      <div className="entity-card-meta-value">+57 300 123 4567</div>
    </div>
  </EntityCard>
</EntityGrid>
```

### 7. `<ListRow>`

**Height:** Always 48px

```tsx
<ListContainer>
  <ListRow
    avatar={<Avatar initials="JD" variant="info" />}
    main="Juan Díaz"
    detail="juan@email.com · +57 300 123 4567"
    badges={<Badge variant="success">Activo</Badge>}
    actions={
      <>
        <IconButton leftIcon={<svg />} />
        <IconButton leftIcon={<svg />} />
      </>
    }
  />
</ListContainer>
```

### 8. `<PageHeader>`

```tsx
<PageHeader
  title="Contactos"
  subtitle="Clientes y datos de contacto"
  resultCount={45}
  actions={
    <Button variant="primary">Nuevo Contacto</Button>
  }
/>
```

### 9. `<Tabs>`

```tsx
<Tabs
  tabs={[
    { id: 'all', label: 'Todos', count: 45 },
    { id: 'active', label: 'Activos', count: 32 }
  ]}
  activeTab={activeTab}
  onChange={setActiveTab}
/>
```

### 10. `<SubscriptionRow>`

```tsx
<SubscriptionRow
  channelBadge={<Badge variant="info">Shopify</Badge>}
  statusBadge={<Badge variant="success">Activa</Badge>}
  contactField={{ key: 'CONTACTO', value: 'Juan Díaz', sub: 'juan@email.com' }}
  productField={{ key: 'PLAN', value: 'Plan Premium', sub: 'SKU 123456' }}
  billingField={{ key: 'COBRANZA', value: 'Débito automático' }}
  priceField={{ value: '$85,000', cycle: '/ mes' }}
  footerActions={
    <>
      <Button variant="secondary" size="sm">Gestionar</Button>
      <Button variant="primary" size="sm">Cobrar</Button>
    </>
  }
/>
```

## 📐 Responsive Behavior

### Breakpoints
- **Mobile:** < 640px
- **Tablet:** 640px – 1024px
- **Desktop:** > 1024px

### Grid Rules

| Component | Desktop | Tablet | Mobile |
|-----------|---------|--------|--------|
| MetricCard | 3 col | 2 col | 1 col |
| EntityCard | 3 col | 2 col | 1 col |
| SubscriptionRow body | 4 col | 2 col | 1 col |

### Toolbar Behavior
- **Desktop:** All items in one row
- **Tablet:** Date inputs collapse into "Filtros" button
- **Mobile:** Search only visible, rest behind filter icon

### Sidebar Behavior
- **Desktop:** Always visible, 220px fixed width
- **Tablet:** Collapsible, icon-only mode (40px) on collapse
- **Mobile:** Drawer overlay

## ✅ Quality Gates

Before considering any view complete, verify:

- [ ] Every button is exactly 36px tall (or 28px sm / 40px lg)
- [ ] Every input and select is exactly 36px tall
- [ ] Every list row is exactly 48px tall
- [ ] Every badge is exactly 20px tall
- [ ] Every action icon button is exactly 28×28px
- [ ] No icon inside a data component exceeds 28px
- [ ] Every card uses border: 0.5px solid var(--gray-200), border-radius: 10px, padding: 14–16px
- [ ] Every card title is 13px/500
- [ ] Every field label is 11px/500/uppercase/var(--gray-400)
- [ ] Every metric value is 22px/500 (18px for sub-metrics)
- [ ] No hardcoded color outside the approved palette
- [ ] No box-shadow on cards (flat design)
- [ ] No spacing value outside multiples of 4
- [ ] Toolbar is the same component in all views
- [ ] PageHeader is the same component in all views
- [ ] Badges are the same component with only 5 variants
- [ ] No button variant outside the 4 canonical variants
- [ ] Sidebar nav items are all 13px, icon 16px, padding 8px 16px
- [ ] Hover states work on: rows (bg + reveal actions), buttons, nav items
- [ ] Focus states work on: all inputs (brand border + focus shadow)
- [ ] Mobile layout tested for all views

## 🚫 What to Kill

**DELETE/REPLACE these patterns:**

| Find | Replace With |
|------|--------------|
| `style="height: Npx"` where N ≠ token values | Use token |
| Inline font-size that isn't 11/12/13/14/16/18/20/22px | Remap to nearest token |
| Button variant outside primary/secondary/danger/ghost | Merge into canonical |
| Badge/chip/tag/pill/status-label that is not `<Badge>` | Replace |
| Card component that is not `<EntityCard>` or `<MetricCard>` | Migrate |
| Toolbar/search-bar/filter-bar that is not canonical `<Toolbar>` | Replace |
| Icon rendered > 28px inside data component | Resize |
| Padding value not from --sp1 through --sp8 | Remap |
| Hardcoded color hex not in approved palette | Replace with token |
| Box-shadow on cards | Remove (flat design) |
| Border-radius not in: 6/8/10/10(pill) | Remap |

## 🎨 Flat Design Principles

1. **No shadows on cards** - Use borders only
2. **No gradients** - Solid colors only
3. **No decorative effects** - Function over form
4. **Consistent spacing** - Multiples of 4px always
5. **Clear hierarchy** - Typography scale enforces structure

## 📝 Migration Checklist

For each view:

1. [ ] Import canonical components from `@/app/ui`
2. [ ] Replace all hardcoded heights with tokens
3. [ ] Replace all hardcoded colors with tokens
4. [ ] Replace all hardcoded spacing with tokens
5. [ ] Replace all hardcoded font-sizes with tokens
6. [ ] Replace all border-radius with tokens
7. [ ] Remove all box-shadows from cards
8. [ ] Verify responsive behavior at all breakpoints
9. [ ] Test hover and focus states
10. [ ] Run quality gates checklist

## 📚 File Structure

```
apps/admin/app/ui/
├── design-tokens.css    # Master token definitions
├── index.ts             # Component exports
├── Button.tsx/.css      # Canonical button
├── Badge.tsx/.css       # Canonical badge
├── Input.tsx/.css       # Canonical input
├── Select.tsx/.css      # Canonical select
├── Toolbar.tsx/.css     # Canonical toolbar
├── MetricCard.tsx/.css  # Metric cards
├── EntityCard.tsx/.css  # Entity cards
├── ListRow.tsx/.css     # List rows
├── SubscriptionRow.tsx/.css  # Subscription rows
├── PageHeader.tsx/.css  # Page headers
└── Tabs.tsx/.css        # Tabs
```

## 🔧 Enforcement

These rules are **non-negotiable**. Any PR that introduces:
- Hardcoded pixel values outside tokens
- New component variants not in this system
- Shadows on cards
- Non-approved colors
- Incorrect heights

...will be rejected and must be refactored to comply with the design system.

---

**Last updated:** 2026-03-25  
**Version:** 3.0  
**Status:** ✅ Implemented
