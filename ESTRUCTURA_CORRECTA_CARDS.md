# 📐 ESTRUCTURA CORRECTA DE CARDS

## ✅ ESTRUCTURA UNIFICADA (TODOS LOS CARDS)

```tsx
<div className="entity-card">
  {/* HEADER - Solo iconos de acción */}
  <div className="entity-card-header">
    <div className="entity-card-header-right">
      <button className="btn-icon-only">✏️</button>
      <button className="btn-icon-only">🗑️</button>
    </div>
  </div>

  {/* BODY - Nombre, campos, info principal */}
  <div className="entity-card-body">
    <div className="entity-card-title">Nombre de la empresa</div>
    <div className="entity-card-sub">email@empresa.com</div>
    
    <div className="entity-card-grid">
      <div>
        <div className="field-hint">Teléfono</div>
        <div>+57 300 123 4567</div>
      </div>
      <div>
        <div className="field-hint">Dirección</div>
        <div>Calle 123 #45-67</div>
      </div>
    </div>
  </div>

  {/* FOOTER - Badges y acciones */}
  <div className="entity-card-footer">
    <div className="entity-card-counts">
      <span className="pill">5 contactos</span>
    </div>
    <button className="btn btn-sm">Ver detalle</button>
  </div>
</div>
```

## ❌ ESTRUCTURA INCORRECTA (ACTUAL)

```tsx
<div className="entity-card">
  <div className="entity-card-header">
    <div>
      <div className="company-name">❌ NOMBRE EN HEADER</div>
      <div className="company-meta">❌ EMAIL EN HEADER</div>
    </div>
    <div className="entity-card-header-right">
      <button>✏️</button>
      <button>🗑️</button>
    </div>
  </div>
  
  <div className="entity-card-grid">
    ❌ CAMPOS SIN CONTENEDOR BODY
  </div>
  
  <div className="entity-card-actions">
    ❌ ACCIONES EN MEDIO
  </div>
  
  <div className="entity-card-footer">
    ❌ FOOTER SIN ESTRUCTURA
  </div>
</div>
```

## 📋 REGLAS DE ORO

1. **Header**: SOLO iconos de acción (editar, eliminar)
2. **Body**: Nombre, subtítulo, campos, información principal
3. **Footer**: Badges, pills, acciones secundarias, botón primario

4. **Iconos**: SIEMPRE 20px, SIEMPRE en línea horizontal
5. **Gap**: SIEMPRE 4px entre iconos, 8px en header
6. **Padding**: SIEMPRE 10px en todo el card

## 🎯 EJEMPLOS POR MÓDULO

### Empresas / Contactos / Productos

```tsx
<div className="entity-card">
  <div className="entity-card-header">
    <div className="entity-card-header-right">
      <button className="btn-icon-only btn-edit">✏️</button>
      <button className="btn-icon-only btn-delete">🗑️</button>
    </div>
  </div>
  
  <div className="entity-card-body">
    <div className="entity-card-title">Empresa SAS</div>
    <div className="entity-card-sub">empresa@email.com</div>
    
    <div className="entity-card-grid">
      <div className="entity-card-meta">
        <div className="entity-card-meta-key">Teléfono</div>
        <div className="entity-card-meta-value">+57 300 123 4567</div>
      </div>
      <div className="entity-card-meta">
        <div className="entity-card-meta-key">Dirección</div>
        <div className="entity-card-meta-value">Calle 123 #45-67</div>
      </div>
    </div>
  </div>
  
  <div className="entity-card-footer">
    <div className="entity-card-counts">
      <Badge variant="neutral">5 contactos</Badge>
    </div>
    <Button variant="secondary" size="sm">Ver detalle</Button>
  </div>
</div>
```

### Billing / Suscripciones

```tsx
<div className="billing-card">
  <div className="billing-header">
    <div className="billing-badges">
      <Badge variant="info">Shopify</Badge>
      <Badge variant="success">Activa</Badge>
    </div>
    <div className="billing-header-actions">
      <button className="btn-icon-only">✏️</button>
      <button className="btn-icon-only">🗑️</button>
    </div>
  </div>
  
  <div className="billing-body">
    <div className="billing-grid-info">
      <div className="billing-field">
        <div className="billing-field-key">CONTACTO</div>
        <div className="billing-field-value">Juan Díaz</div>
        <div className="billing-field-sub">juan@email.com</div>
      </div>
      <div className="billing-field">
        <div className="billing-field-key">PLAN</div>
        <div className="billing-field-value">Plan Premium</div>
        <div className="billing-field-sub">SKU 123456</div>
      </div>
      <div className="billing-field">
        <div className="billing-field-key">COBRANZA</div>
        <div className="billing-field-value">Débito automático</div>
      </div>
      <div className="billing-field billing-field-price">
        <div className="billing-field-value">$85,000</div>
        <div className="billing-field-sub">/ mes</div>
      </div>
    </div>
  </div>
  
  <div className="billing-footer">
    <Button variant="secondary" size="sm">Gestionar</Button>
    <Button variant="primary" size="sm">Cobrar</Button>
  </div>
</div>
```

### Contact List / Pagos / Logs

```tsx
<div className="list-container">
  <div className="list-row">
    <div className="list-row-avatar">JD</div>
    
    <div className="list-row-main">
      <div className="list-row-name">Juan Díaz</div>
      <div className="list-row-detail">juan@email.com · +57 300 123 4567</div>
    </div>
    
    <div className="list-row-badges">
      <Badge variant="success">Activo</Badge>
    </div>
    
    <div className="list-row-actions">
      <button className="btn-icon-only">✏️</button>
      <button className="btn-icon-only">🗑️</button>
    </div>
  </div>
</div>
```

## 🔧 CAMBIOS A APLICAR

### 1. Mover nombre del header al body
```diff
- <div className="entity-card-header">
-   <div className="company-name">Nombre</div>
- </div>
- <div className="entity-card-body">
+ <div className="entity-card-body">
+   <div className="company-name">Nombre</div>
```

### 2. Header solo con iconos
```diff
<div className="entity-card-header">
-  <div className="company-info">
-    <div className="company-name">Nombre</div>
-  </div>
  <div className="entity-card-header-right">
    <button className="btn-icon-only">✏️</button>
    <button className="btn-icon-only">🗑️</button>
  </div>
</div>
```

### 3. Body con contenido principal
```diff
<div className="entity-card-body">
+  <div className="entity-card-title">Nombre</div>
+  <div className="entity-card-sub">email@email.com</div>
  <div className="entity-card-grid">
    <!-- Campos -->
  </div>
</div>
```

---

**Fecha:** 2026-03-25  
**Estado:** ✅ DOCUMENTADO - PENDIENTE DE IMPLEMENTAR
