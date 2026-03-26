# Migración de Vistas - Guía Práctica

## Ejemplo: Migrando la vista de Contactos

### Antes (código legacy)

```tsx
// apps/admin/app/customers/page.tsx (ANTES)
export default async function CustomersPage({ searchParams }) {
  return (
    <main className="page">
      {/* Header custom */}
      <div style={{ paddingBottom: 16, borderBottom: '1px solid #e5e5e5', marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>Contactos</h1>
        <p style={{ fontSize: 13, color: '#888' }}>Clientes y datos de contacto</p>
      </div>

      {/* Toolbar custom */}
      <div style={{ 
        display: 'flex', 
        gap: 8, 
        padding: '12px 16px',
        background: 'white',
        border: '1px solid #e5e5e5',
        borderRadius: 10
      }}>
        <input 
          type="search" 
          placeholder="Buscar..."
          style={{ 
            flex: 1, 
            height: 32,  // ❌ Altura incorrecta
            padding: '0 10px',
            border: '1px solid #e5e5e5',
            borderRadius: 6
          }}
        />
        <button style={{ 
          height: 32,  // ❌ Altura incorrecta
          padding: '0 16px',
          background: '#6B4FE0',
          color: 'white',
          border: 'none',
          borderRadius: 6
        }}>
          Nuevo Contacto
        </button>
      </div>

      {/* Lista custom */}
      <div style={{ background: 'white', border: '1px solid #e5e5e5', borderRadius: 10 }}>
        {items.map(c => (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center',
            height: 56,  // ❌ Altura incorrecta (debe ser 48px)
            padding: '0 16px',
            borderBottom: '1px solid #e5e5e5'
          }}>
            <div style={{ 
              width: 40,  // ❌ Avatar muy grande
              height: 40,
              borderRadius: '50%',
              background: '#e5e5e5'
            }}>
              {c.nombre[0]}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{c.nombre}</div>
              <div style={{ fontSize: 12, color: '#888' }}>{c.email}</div>
            </div>
            <div style={{ 
              padding: '4px 12px',  // ❌ Badge sin altura fija
              background: '#e1f5ee',
              color: '#085041',
              borderRadius: 12
            }}>
              Activo
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
```

### Después (código migrado)

```tsx
// apps/admin/app/customers/page.tsx (DESPUÉS)
import { 
  PageHeader, 
  Toolbar, 
  ToolbarSearch, 
  ToolbarActions,
  Button,
  ListContainer,
  ListRow,
  Avatar,
  Badge,
  EntityGrid,
  EntityCard
} from '@/app/ui';

export default async function CustomersPage({ searchParams }) {
  const vista = searchParams?.vista || 'cards';

  return (
    <main className="page">
      {/* ✅ Header canónico */}
      <PageHeader
        title="Contactos"
        subtitle="Clientes y datos de contacto"
        resultCount={items.length}
        actions={
          <Button variant="primary">Nuevo Contacto</Button>
        }
      />

      {/* ✅ Toolbar canónico */}
      <Toolbar>
        <ToolbarSearch placeholder="Buscar por nombre, email, teléfono..." />
        <ToolbarActions>
          <Button variant="primary" leftIcon={
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/>
            </svg>
          }>
            Nuevo Contacto
          </Button>
        </ToolbarActions>
      </Toolbar>

      {/* ✅ Vista de tarjetas */}
      {vista === 'cards' ? (
        <EntityGrid>
          {items.map(c => (
            <EntityCard
              key={c.id}
              title={c.nombre}
              subtitle={c.email || 'Sin email'}
              footer={
                <>
                  <Badge variant="neutral">
                    {c._count?.contactos || 0} contactos
                  </Badge>
                  <Button variant="secondary" size="sm">
                    Ver detalle
                  </Button>
                </>
              }
            >
              <div className="entity-card-meta">
                <div className="entity-card-meta-key">Teléfono</div>
                <div className="entity-card-meta-value">
                  {c.telefono || '—'}
                </div>
              </div>
              <div className="entity-card-meta">
                <div className="entity-card-meta-key">Empresa</div>
                <div className="entity-card-meta-value">
                  {c.empresa || '—'}
                </div>
              </div>
            </EntityCard>
          ))}
        </EntityGrid>
      ) : (
        /* ✅ Vista de lista */
        <ListContainer>
          {items.map(c => (
            <ListRow
              key={c.id}
              avatar={
                <Avatar 
                  initials={c.nombre.split(' ').map(n => n[0]).join('').slice(0, 2)} 
                  variant={c.activo ? 'success' : 'neutral'} 
                />
              }
              main={c.nombre}
              detail={`${c.email || 'Sin email'} · ${c.telefono || 'Sin teléfono'}`}
              badges={
                <Badge variant={c.activo ? 'success' : 'neutral'}>
                  {c.activo ? 'Activo' : 'Inactivo'}
                </Badge>
              }
              actions={
                <>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    leftIcon={
                      <svg viewBox="0 0 24 24" width="16" height="16">
                        <path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    }
                  />
                  <Button 
                    variant="ghost" 
                    size="icon"
                    leftIcon={
                      <svg viewBox="0 0 24 24" width="16" height="16">
                        <path d="M3 6h18M8 6V4h8v2m-8 0l1 12h6l1-12" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    }
                  />
                </>
              }
            />
          ))}
        </ListContainer>
      )}
    </main>
  );
}
```

## Cambios Clave

### 1. Alturas Fixed
- ❌ `height: 32` → ✅ `height: var(--h-input)` (36px)
- ❌ `height: 56` → ✅ `height: var(--h-row)` (48px)
- ❌ `width: 40` → ✅ `width: var(--h-avatar)` (28px)

### 2. Typography
- ❌ `fontSize: 18` → ✅ `var(--text-page-title)` (20px)
- ❌ `fontSize: 14` → ✅ `var(--text-card-header)` (13px)
- ❌ `fontSize: 12` → ✅ `var(--text-meta)` (12px)

### 3. Spacing
- ❌ `gap: 8` → ✅ `gap: var(--sp2)`
- ❌ `padding: '12px 16px'` → ✅ `padding: var(--sp3) var(--sp4)`
- ❌ `marginBottom: 20` → ✅ `margin-bottom: var(--sp5)`

### 4. Colors
- ❌ `#6B4FE0` → ✅ `var(--brand)`
- ❌ `#e5e5e5` → ✅ `var(--gray-200)`
- ❌ `#888` → ✅ `var(--gray-400)`
- ❌ `#e1f5ee` → ✅ `var(--success-light)`

### 5. Border Radius
- ❌ `borderRadius: 6` → ✅ `var(--radius-sm)`
- ❌ `borderRadius: 12` → ✅ `var(--radius-pill)`
- ❌ `borderRadius: 10` → ✅ `var(--radius-lg)`

## Checklist de Migración

Para cada vista:

1. [ ] Reemplazar header custom con `<PageHeader>`
2. [ ] Reemplazar toolbar custom con `<Toolbar>`
3. [ ] Reemplazar inputs con `<Input>` o `<ToolbarSearch>`
4. [ ] Reemplazar botones con `<Button>`
5. [ ] Reemplazar badges con `<Badge>`
6. [ ] Reemplazar lista custom con `<ListContainer>` + `<ListRow>`
7. [ ] Reemplazar tarjetas custom con `<EntityGrid>` + `<EntityCard>`
8. [ ] Reemplazar avatares custom con `<Avatar>`
9. [ ] Verificar todas las alturas (36px inputs, 48px rows, 20px badges)
10. [ ] Verificar responsive behavior

## Vistas a Migrar

### Prioridad Alta (core del negocio)
- [ ] `/` (Métricas) - Usar `<MetricGrid>` + `<MetricCard>`
- [ ] `/payments` (Pagos) - Usar `<ListRow>`
- [ ] `/customers` (Contactos) - Usar `<ListRow>` o `<EntityCard>`
- [ ] `/billing` (Suscripciones) - Usar `<SubscriptionRow>`
- [ ] `/empresas` (Empresas) - Usar `<EntityCard>`

### Prioridad Media
- [ ] `/products` (Productos) - Usar `<EntityCard>` o `<ListRow>`
- [ ] `/logs` (Logs) - Usar `<ListRow>`
- [ ] `/notifications` (Notificaciones) - Usar `<ListRow>`
- [ ] `/campaigns` (Mensajes masivos) - Usar `<ListRow>`

### Prioridad Baja
- [ ] `/settings` (Configuración) - Usar `<Input>` + `<Select>`
- [ ] `/appearance` (Apariencia) - Ya usa tokens
- [ ] `/sa` (Super Admin) - Usar componentes canónicos

## Beneficios de la Migración

1. **Consistencia visual** - Todas las vistas se ven y comportan igual
2. **Mantenibilidad** - Cambios en un componente se propagan a todo el sistema
3. **Accesibilidad** - Componentes probados con WCAG
4. **Responsive** - Comportamiento móvil/tablet/desktop garantizado
5. **Performance** - CSS optimizado y sin duplicación
6. **Developer Experience** - API consistente y documentada

---

**Nota:** Esta migración es **no negociable**. Todas las vistas deben usar los componentes canónicos para garantizar la consistencia del sistema.
