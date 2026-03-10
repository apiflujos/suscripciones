# Referencia de Componentes - ApiFlujos Design System

## Índice

1. [Botones](#botones)
2. [Tarjetas (Cards)](#tarjetas-cards)
3. [Tarjetas de Producto](#tarjetas-de-producto)
4. [Badges / Pills](#badges--pills)
5. [Formularios](#formularios)
6. [Listas](#listas)
7. [Tablas](#tablas)
8. [Tipografía](#tipografía)
9. [Utilidades](#utilidades)

---

## Botones

### Clases Base

| Clase | Descripción |
|-------|-------------|
| `.btn` | Clase base para todos los botones |
| `.btn-primary` | Botón primario (color de marca) |
| `.btn-outline` | Botón con borde, fondo transparente |
| `.btn-success` | Botón verde (acciones positivas) |
| `.btn-danger` | Botón rojo (acciones destructivas) |
| `.btn-secondary` | Botón gris (acciones secundarias) |
| `.btn-ghost` | Botón fantasma (minimalista) |

### Variantes Extendidas

| Clase | Color | Uso |
|-------|-------|-----|
| `.btn-indigo` | Azul índigo | Acciones alternativas |
| `.btn-teal` | Verde azulado | Confirmaciones |
| `.btn-amber` | Ámbar | Advertencias |
| `.btn-link-action` | Azul | Links de pago |

### Ejemplos

```html
<!-- Botón Primario -->
<button class="btn btn-primary">
  <i data-lucide="check"></i>
  Guardar Cambios
</button>

<!-- Botón con Ícono -->
<button class="btn btn-primary">
  <i data-lucide="shopping-cart"></i>
  Añadir al Carrito
</button>

<!-- Botón Outline -->
<button class="btn btn-outline">
  Cancelar
</button>

<!-- Botón Success -->
<button class="btn btn-success">
  <i data-lucide="check-circle"></i>
  Confirmar
</button>

<!-- Botón Danger -->
<button class="btn btn-danger">
  <i data-lucide="trash-2"></i>
  Eliminar
</button>

<!-- Botón Secundario -->
<button class="btn btn-secondary">
  <i data-lucide="settings"></i>
  Configurar
</button>

<!-- Botón Link de Pago -->
<button class="btn btn-link-action">
  <i data-lucide="send"></i>
  Enviar Link de Pago
</button>

<!-- Botón Ghost -->
<button class="btn btn-ghost">
  <i data-lucide="more-horizontal"></i>
  Más opciones
</button>

<!-- Botón Indigo -->
<button class="btn btn-indigo">
  <i data-lucide="package"></i>
  Añadir Producto
</button>

<!-- Botón Teal -->
<button class="btn btn-teal">
  <i data-lucide="download"></i>
  Descargar
</button>

<!-- Botón Amber -->
<button class="btn btn-amber">
  <i data-lucide="alert-triangle"></i>
  Precaución
</button>
```

### Estados

```css
/* Hover - Automático con :hover */
.btn-primary:hover {
  background: var(--btn-primary-hover);
}

/* Disabled - Añadir atributo disabled */
<button class="btn btn-primary" disabled>
  Deshabilitado
</button>

/* Active - Añadir clase .active o usar :active */
<button class="btn btn-primary active">
  Activo
</button>
```

### Tamaños

```html
<!-- Pequeño (usando CSS inline o clase custom) -->
<button class="btn btn-primary" style="font-size: 11px; padding: 0.25rem 0.5rem;">
  XS
</button>

<!-- Normal (default) -->
<button class="btn btn-primary">Normal</button>

<!-- Grande -->
<button class="btn btn-primary" style="font-size: 14px; padding: 0.5rem 1rem;">
  Grande
</button>
```

---

## Tarjetas (Cards)

### Clases

| Clase | Descripción |
|-------|-------------|
| `.card` | Card estándar |
| `.card.is-lilac` | Card con fondo lila suave |

### Ejemplos

```html
<!-- Card Estándar -->
<div class="card">
  <h3 style="color: var(--text-heading);">Título</h3>
  <p style="color: var(--text-body);">
    Contenido de la tarjeta con texto normal.
  </p>
  <button class="btn btn-primary" style="margin-top: 1rem;">
    Acción
  </button>
</div>

<!-- Card con Fondo Lila -->
<div class="card is-lilac">
  <h3 style="color: var(--text-heading);">Título Destacado</h3>
  <p style="color: var(--text-body);">
    Esta tarjeta tiene un fondo lila suave para destacar.
  </p>
  <div style="margin-top: 1rem;">
    <span class="pill pill-success">Destacado</span>
  </div>
</div>

<!-- Card Estadística -->
<div class="card is-lilac">
  <p style="color: var(--text-muted); font-size: 0.875rem;">Ventas Totales</p>
  <p class="product-price" style="font-size: 2.5rem; margin: 0.5rem 0;">
    $12,450
  </p>
  <span class="pill pill-success">
    <i data-lucide="trending-up"></i> +15%
  </span>
</div>

<!-- Card con Header -->
<div class="card">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
    <h3 style="color: var(--text-heading); margin: 0;">Título</h3>
    <button class="btn btn-ghost">
      <i data-lucide="more-vertical"></i>
    </button>
  </div>
  <p style="color: var(--text-body);">Contenido...</p>
</div>
```

---

## Tarjetas de Producto

### Clases

| Clase | Descripción |
|-------|-------------|
| `.product-grid` | Grid contenedor de productos |
| `.product-card` | Card de producto estándar |
| `.product-card.is-lilac` | Card de producto con fondo lila |
| `.product-img` | Contenedor de imagen del producto |
| `.product-body` | Cuerpo de la card |
| `.product-name` | Nombre del producto |
| `.product-price` | Precio destacado |
| `.product-stock` | Información de stock |

### Ejemplos

```html
<!-- Grid de Productos -->
<div class="product-grid">
  
  <!-- Producto Estándar -->
  <div class="product-card">
    <div class="product-img">
      <i data-lucide="package" size="48"></i>
    </div>
    <div class="product-body">
      <div class="product-name">Camiseta Premium</div>
      <div class="product-price">$25.00</div>
      <div class="product-stock">
        <i data-lucide="layers"></i>
        Stock: 142 unidades
      </div>
      <button class="btn btn-indigo">
        <i data-lucide="shopping-cart"></i>
        Añadir al Carrito
      </button>
    </div>
  </div>
  
  <!-- Producto Destacado (Lila) -->
  <div class="product-card is-lilac">
    <div class="product-img">
      <i data-lucide="star" size="48"></i>
    </div>
    <div class="product-body">
      <div class="product-name">Suscripción SaaS</div>
      <div class="product-price">$299.00</div>
      <div class="product-stock">
        <i data-lucide="check-circle"></i>
        Servicio Activo
      </div>
      <button class="btn btn-link-action">
        <i data-lucide="send"></i>
        Enviar Link Pago
      </button>
    </div>
  </div>
  
  <!-- Producto con Stock Bajo -->
  <div class="product-card">
    <div class="product-img">
      <i data-lucide="cpu" size="48"></i>
    </div>
    <div class="product-body">
      <div class="product-name">API Key Industrial</div>
      <div class="product-price">$1,200.00</div>
      <div class="product-stock">
        <i data-lucide="alert-triangle" style="color: var(--warning);"></i>
        Stock Bajo: 3
      </div>
      <button class="btn btn-secondary">
        <i data-lucide="settings"></i>
        Configurar API
      </button>
    </div>
  </div>
  
</div>
```

---

## Badges / Pills

### Clases

| Clase | Descripción | Color |
|-------|-------------|-------|
| `.pill` | Clase base | - |
| `.pill-success` | Estado exitoso | Verde |
| `.pill-warning` | Advertencia | Ámbar |
| `.pill-error` | Error | Rojo |
| `.pill-info` | Información | Azul |

### Ejemplos

```html
<!-- Pill Success -->
<span class="pill pill-success">
  <i data-lucide="check" style="width: 12px; height: 12px;"></i>
  Completado
</span>

<!-- Pill Warning -->
<span class="pill pill-warning">
  <i data-lucide="alert-circle" style="width: 12px; height: 12px;"></i>
  Pendiente
</span>

<!-- Pill Error -->
<span class="pill pill-error">
  <i data-lucide="x-circle" style="width: 12px; height: 12px;"></i>
  Error
</span>

<!-- Pill Info -->
<span class="pill pill-info">
  <i data-lucide="info" style="width: 12px; height: 12px;"></i>
  Información
</span>

<!-- Pill sin ícono -->
<span class="pill pill-success">Activo</span>
<span class="pill pill-warning">Revisar</span>
```

---

## Formularios

### Clases

| Clase | Descripción |
|-------|-------------|
| `.input-group` | Contenedor de grupo de input |
| `.input-label` | Label del input |
| `.input-control` | Input/textarea/select |
| `.input-with-icon` | Input con ícono decorativo |

### Ejemplos

```html
<!-- Input Simple -->
<div class="input-group">
  <label class="input-label">Email</label>
  <input type="email" class="input-control" placeholder="tu@email.com">
</div>

<!-- Input con Ícono -->
<div class="input-group">
  <label class="input-label">Buscar</label>
  <div class="input-with-icon">
    <i data-lucide="search"></i>
    <input type="text" class="input-control" placeholder="Buscar productos...">
  </div>
</div>

<!-- Múltiple Inputs -->
<div class="input-group">
  <label class="input-label">Nombre Completo</label>
  <input type="text" class="input-control" placeholder="Juan Pérez">
</div>

<div class="input-group">
  <label class="input-label">Teléfono</label>
  <div class="input-with-icon">
    <i data-lucide="phone"></i>
    <input type="tel" class="input-control" placeholder="+34 600 000 000">
  </div>
</div>

<!-- Textarea -->
<div class="input-group">
  <label class="input-label">Mensaje</label>
  <textarea class="input-control" rows="4" placeholder="Escribe tu mensaje..."></textarea>
</div>

<!-- Select -->
<div class="input-group">
  <label class="input-label">Categoría</label>
  <select class="input-control">
    <option value="">Seleccionar...</option>
    <option value="1">Categoría 1</option>
    <option value="2">Categoría 2</option>
  </select>
</div>

<!-- Checkbox -->
<div class="input-group">
  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
    <input type="checkbox" style="width: 16px; height: 16px;">
    <span style="color: var(--text-body); font-size: 0.875rem;">
      Acepto los términos y condiciones
    </span>
  </label>
</div>

<!-- Input con Estado de Error -->
<div class="input-group">
  <label class="input-label">Email</label>
  <input type="email" class="input-control" 
         style="border-color: var(--error);" 
         value="email-invalido">
  <small style="color: var(--error); margin-top: 0.25rem; display: block;">
    <i data-lucide="alert-circle" style="width: 12px; height: 12px; vertical-align: middle;"></i>
    Email inválido
  </small>
</div>
```

---

## Listas

### Clases

| Clase | Descripción |
|-------|-------------|
| `.list-card` | Card de lista (contacto/suscripción) |
| `.list-card.is-lilac` | Card con fondo lila |
| `.list-card-left` | Contenedor izquierdo (avatar + info) |
| `.list-card-right` | Contenedor derecho (precio + acciones) |
| `.avatar` | Avatar circular con iniciales |
| `.contact-info` | Información de contacto |
| `.contact-name` | Nombre del contacto |
| `.contact-meta` | Meta-información (email, teléfono) |
| `.price` | Precio destacado |

### Ejemplos

```html
<!-- Lista de Contactos -->
<div>
  <!-- Contacto Estándar -->
  <div class="list-card">
    <div class="list-card-left">
      <div class="avatar">JP</div>
      <div class="contact-info">
        <div class="contact-name">Juan Pérez</div>
        <div class="contact-meta">juan@email.com</div>
      </div>
    </div>
    <div class="list-card-right">
      <div class="price">$29.99</div>
      <button class="btn btn-primary">Ver</button>
    </div>
  </div>
  
  <!-- Contacto Destacado (Lila) -->
  <div class="list-card is-lilac">
    <div class="list-card-left">
      <div class="avatar" style="background: var(--royal-purple-200); color: var(--royal-purple-700);">
        MG
      </div>
      <div class="contact-info">
        <div class="contact-name">María García</div>
        <div class="contact-meta">maria@email.com</div>
      </div>
    </div>
    <div class="list-card-right">
      <div class="price">$49.99</div>
      <button class="btn btn-primary">Ver</button>
    </div>
  </div>
  
  <!-- Contacto con Estado -->
  <div class="list-card">
    <div class="list-card-left">
      <div class="avatar">RL</div>
      <div class="contact-info">
        <div class="contact-name">Roberto López</div>
        <div class="contact-meta">
          <span class="pill pill-success" style="font-size: 0.65rem; padding: 0.15rem 0.5rem;">
            Activo
          </span>
        </div>
      </div>
    </div>
    <div class="list-card-right">
      <div class="price">$99.99</div>
      <button class="btn btn-outline">Editar</button>
    </div>
  </div>
</div>
```

---

## Tablas

### Clases

| Clase | Descripción |
|-------|-------------|
| `.compat-table` | Tabla estándar |
| `.payments-table` | Tabla de pagos/suscripciones |

### Ejemplo

```html
<div class="payments-preview">
  <div class="payments-toolbar">
    <span class="payments-title">Suscripciones Recientes</span>
    <button class="btn btn-primary">
      <i data-lucide="plus"></i> Nueva
    </button>
  </div>
  
  <table class="payments-table">
    <thead>
      <tr>
        <th>Cliente</th>
        <th>Plan</th>
        <th>Estado</th>
        <th>Precio</th>
        <th>Acciones</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Juan Pérez</td>
        <td>Premium</td>
        <td>
          <span class="status-chip is-success">
            <i data-lucide="check" style="width: 10px; height: 10px;"></i>
            Activo
          </span>
        </td>
        <td>$29.99/mes</td>
        <td>
          <button class="btn btn-ghost">
            <i data-lucide="more-vertical"></i>
          </button>
        </td>
      </tr>
      <tr>
        <td>María García</td>
        <td>Básico</td>
        <td>
          <span class="status-chip is-warning">
            <i data-lucide="clock" style="width: 10px; height: 10px;"></i>
            Pendiente
          </span>
        </td>
        <td>$9.99/mes</td>
        <td>
          <button class="btn btn-ghost">
            <i data-lucide="more-vertical"></i>
          </button>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

---

## Tipografía

### Clases de Texto

| Clase | Descripción |
|-------|-------------|
| `.section-title` | Título de sección |
| `.brand-title` | Título de marca |
| `.text-muted` | Texto atenuado |
| `.product-name` | Nombre de producto |
| `.product-price` | Precio destacado |
| `.contact-name` | Nombre de contacto |
| `.contact-meta` | Meta-info de contacto |

### Jerarquía Tipográfica

```html
<!-- H1 - Encabezado Principal -->
<h1 style="font-size: 2.5rem; color: var(--text-heading);">
  Título Principal H1
</h1>

<!-- H2 - Subtítulo de Sección -->
<h2 style="font-size: 1.75rem; color: var(--text-heading);">
  Subtítulo H2
</h2>

<!-- H3 - Título de Tarjeta -->
<h3 style="font-size: 1.25rem; color: var(--text-heading);">
  Título de Card H3
</h3>

<!-- Párrafo -->
<p style="color: var(--text-body); line-height: 1.6;">
  Texto corporal del contenido.
</p>

<!-- Texto Atenuado -->
<p class="text-muted" style="color: var(--text-muted); font-size: 0.875rem;">
  Texto secundario o hints.
</p>

<!-- Título de Sección (clase utilitaria) -->
<h2 class="section-title">Nombre de la Sección</h2>
```

---

## Utilidades

### Theme Selector

```html
<div class="theme-selector">
  <button class="theme-btn active" data-theme="light">Claro</button>
  <button class="theme-btn" data-theme="dark">Oscuro</button>
  <button class="theme-btn" data-theme="high-contrast">Alto Contraste</button>
  <button class="theme-btn" data-theme="safe">Accesibilidad</button>
</div>
```

### Contenedores

```html
<!-- Contenedor Principal -->
<div class="container">
  <!-- Contenido centrado con max-width: 1200px -->
</div>

<!-- Grid de Componentes -->
<div class="component-grid">
  <!-- Items en grid responsive -->
</div>

<!-- Grid de Productos -->
<div class="product-grid">
  <!-- Cards de productos -->
</div>
```

### Utilidades de Tema

```html
<!-- Solo visible en tema claro/oscuro -->
<div class="brand-only">
  Contenido solo en temas de marca
</div>

<!-- Solo visible en alto contraste -->
<div class="hc-only">
  Contenido solo en alto contraste
</div>

<!-- Solo visible en modo accesibilidad -->
<div class="safe-only">
  Contenido solo en modo safe
</div>

<!-- Oculto en alto contraste -->
<div class="no-hc">
  Contenido oculto en HC
</div>

<!-- Oculto en modo safe -->
<div class="no-safe">
  Contenido oculto en safe
</div>
```

---

## Íconos (Lucide)

### Uso Básico

```html
<!-- Ícono inline -->
<i data-lucide="check"></i>

<!-- Ícono con tamaño -->
<i data-lucide="check" size="24"></i>

<!-- Ícono en botón -->
<button class="btn btn-primary">
  <i data-lucide="check" style="width: 14px; height: 14px;"></i>
  Guardar
</button>
```

### Íconos Comunes

```html
<i data-lucide="check"></i>        <!-- Confirmar -->
<i data-lucide="x"></i>            <!-- Cerrar/Eliminar -->
<i data-lucide="plus"></i>         <!-- Añadir -->
<i data-lucide="edit"></i>         <!-- Editar -->
<i data-lucide="trash-2"></i>      <!-- Eliminar -->
<i data-lucide="search"></i>       <!-- Buscar -->
<i data-lucide="settings"></i>     <!-- Configurar -->
<i data-lucide="user"></i>         <!-- Usuario -->
<i data-lucide="mail"></i>         <!-- Email -->
<i data-lucide="phone"></i>        <!-- Teléfono -->
<i data-lucide="home"></i>         <!-- Inicio -->
<i data-lucide="menu"></i>         <!-- Menú -->
<i data-lucide="more-vertical"></i> <!-- Más opciones -->
<i data-lucide="chevron-right"></i> <!-- Siguiente -->
<i data-lucide="chevron-down"></i>  <!-- Desplegar -->
<i data-lucide="external-link"></i> <!-- Link externo -->
<i data-lucide="download"></i>      <!-- Descargar -->
<i data-lucide="upload"></i>        <!-- Subir -->
<i data-lucide="calendar"></i>      <!-- Calendario -->
<i data-lucide="clock"></i>         <!-- Tiempo -->
<i data-lucide="bell"></i>          <!-- Notificación -->
<i data-lucide="star"></i>          <!-- Favorito -->
<i data-lucide="heart"></i>         <!-- Like -->
<i data-lucide="share-2"></i>       <!-- Compartir -->
<i data-lucide="copy"></i>          <!-- Copiar -->
<i data-lucide="eye"></i>           <!-- Ver -->
<i data-lucide="eye-off"></i>       <!-- Ocultar -->
<i data-lucide="lock"></i>          <!-- Bloqueado -->
<i data-lucide="unlock"></i>        <!-- Desbloqueado -->
<i data-lucide="check-circle"></i>  <!-- Éxito -->
<i data-lucide="alert-circle"></i>  <!-- Advertencia -->
<i data-lucide="x-circle"></i>      <!-- Error -->
<i data-lucide="info"></i>          <!-- Información -->
<i data-lucide="help-circle"></i>   <!-- Ayuda -->
<i data-lucide="trending-up"></i>   <!-- Subida -->
<i data-lucide="trending-down"></i> <!-- Bajada -->
<i data-lucide="package"></i>       <!-- Producto -->
<i data-lucide="shopping-cart"></i> <!-- Carrito -->
<i data-lucide="credit-card"></i>   <!-- Pago -->
<i data-lucide="dollar-sign"></i>   <!-- Dinero -->
<i data-lucide="layers"></i>        <!-- Stock -->
<i data-lucide="cpu"></i>           <!-- API/Tech -->
<i data-lucide="smartphone"></i>    <!-- Móvil -->
<i data-lucide="monitor"></i>       <!-- Desktop -->
<i data-lucide="sun"></i>           <!-- Tema claro -->
<i data-lucide="moon"></i>          <!-- Tema oscuro -->
<i data-lucide="contrast"></i>      <!-- Alto contraste -->
```

---

**ApiFlujos Design System - Referencia de Componentes v1.0**
