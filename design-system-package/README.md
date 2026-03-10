# ApiFlujos Design System

Sistema de diseño completo para ApiFlujos con soporte multi-tema, accesibilidad y componentes listos para producción.

## 📁 Estructura del Paquete

```
design-system-package/
├── apiflujos-design-system.html    # Archivo principal del design system
├── README.md                        # Este archivo
├── docs/
│   ├── IMPLEMENTATION_GUIDE.md     # Guía de implementación detallada
│   ├── COMPONENT_REFERENCE.md      # Referencia de componentes
│   └── COLOR_PALETTE.md            # Documentación de colores
├── scripts/
│   └── integrate-design-system.sh  # Script de integración automática
├── templates/
│   └── basic-template.html         # Plantilla base para nuevos proyectos
└── examples/
    └── usage-examples.html         # Ejemplos de uso de componentes
```

## 🎨 Temas Disponibles

| Tema | Descripción | Uso |
|------|-------------|-----|
| `light` | Tema claro con fondo blanco y módulos en lila | Por defecto |
| `dark` | Tema oscuro brand ApiFlujos | Modo nocturno |
| `high-contrast` | Alto contraste (WCAG AAA) | Accesibilidad |
| `safe` | Palette Okabe-Ito | Daltonismo |

## 🚀 Inicio Rápido

### Opción 1: Copiar HTML Directamente

```html
<!DOCTYPE html>
<html lang="es" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mi Proyecto ApiFlujos</title>
  
  <!-- Copiar todo el <style> del design system aquí -->
</head>
<body>
  <!-- Tu contenido -->
</body>
</html>
```

### Opción 2: Usar el Script de Integración

```bash
cd design-system-package
bash scripts/integrate-design-system.sh /ruta/a/tu/proyecto
```

### Opción 3: CDN (Recomendado para Producción)

```html
<link rel="stylesheet" href="https://cdn.apiflujos.com/design-system/v1/apiflujos-ds.css">
```

## 📦 Componentes Disponibles

### Botones

```html
<!-- Botón Primario -->
<button class="btn btn-primary">
  <i data-lucide="check"></i> Guardar
</button>

<!-- Botón Outline -->
<button class="btn btn-outline">Cancelar</button>

<!-- Botón Success -->
<button class="btn btn-success">Confirmar</button>

<!-- Botón Danger -->
<button class="btn btn-danger">Eliminar</button>

<!-- Botón con estilo lila -->
<button class="btn btn-primary" style="background: var(--royal-purple-500);">
  Acción Especial
</button>
```

### Tarjetas (Cards)

```html
<!-- Card Estándar -->
<div class="card">
  <h3>Título</h3>
  <p>Contenido de la tarjeta</p>
</div>

<!-- Card con estilo lila -->
<div class="card is-lilac">
  <h3>Título en Lila</h3>
  <p>Esta tarjeta tiene fondo lila suave</p>
</div>
```

### Tarjetas de Producto

```html
<!-- Producto Estándar -->
<div class="product-card">
  <div class="product-img">
    <i data-lucide="package" size="48"></i>
  </div>
  <div class="product-body">
    <div class="product-name">Nombre Producto</div>
    <div class="product-price">$99.00</div>
    <button class="btn btn-primary">Comprar</button>
  </div>
</div>

<!-- Producto con estilo lila -->
<div class="product-card is-lilac">
  <!-- Contenido -->
</div>
```

### Badges / Pills

```html
<span class="pill pill-success">Completado</span>
<span class="pill pill-warning">Pendiente</span>
<span class="pill pill-error">Error</span>
<span class="pill pill-info">Info</span>
```

### Formularios

```html
<div class="input-group">
  <label class="input-label">Email</label>
  <input type="email" class="input-control" placeholder="tu@email.com">
</div>

<!-- Input con ícono -->
<div class="input-group">
  <label class="input-label">Buscar</label>
  <div class="input-with-icon">
    <i data-lucide="search"></i>
    <input type="text" class="input-control" placeholder="Buscar...">
  </div>
</div>
```

### Listas / Contactos

```html
<!-- Lista Estándar -->
<div class="list-card">
  <div class="list-card-left">
    <div class="avatar">JD</div>
    <div class="contact-info">
      <div class="contact-name">Juan Díaz</div>
      <div class="contact-meta">juan@email.com</div>
    </div>
  </div>
  <div class="list-card-right">
    <div class="price">$29.99</div>
    <button class="btn btn-primary">Ver</button>
  </div>
</div>

<!-- Lista con estilo lila -->
<div class="list-card is-lilac">
  <!-- Contenido -->
</div>
```

## 🎨 Variables CSS Principales

### Colores de Marca (Royal Purple)

```css
--royal-purple-50: #f9f7fd;    /* Lila muy claro */
--royal-purple-100: #f1edfa;   /* Lila claro */
--royal-purple-200: #e6def6;   /* Lila suave */
--royal-purple-300: #d3c3ef;   /* Lila medio */
--royal-purple-400: #b89de3;   /* Lila */
--royal-purple-500: #9c77d5;   /* Lila intenso */
--royal-purple-600: #8559c4;   /* Morado */
--royal-purple-700: #6d44a6;   /* Morado oscuro (Primary) */
--royal-purple-800: #5f3d8c;   /* Morado muy oscuro */
--royal-purple-900: #4e3271;   /* Morado profundo */
--royal-purple-950: #331a51;   /* Morado casi negro */
```

### Variables por Tema

```css
/* Tema Claro */
--bg-body: #FFFFFF;           /* Fondo principal blanco */
--bg-panel: #F8F9FA;          /* Fondo de paneles */
--bg-hover: var(--royal-purple-50);

/* Tema Oscuro */
--bg-body: #0a0510;
--bg-panel: #160e22;
--bg-hover: #261638;
```

## 🔄 Cambio de Tema

### JavaScript (Manual)

```javascript
// Cambiar a tema oscuro
document.documentElement.setAttribute('data-theme', 'dark');

// Cambiar a tema claro
document.documentElement.setAttribute('data-theme', 'light');

// Cambiar a alto contraste
document.documentElement.setAttribute('data-theme', 'high-contrast');

// Cambiar a modo accesibilidad
document.documentElement.setAttribute('data-theme', 'safe');

// Guardar preferencia
localStorage.setItem('theme', 'dark');
```

### Selector de Temas (UI)

```html
<div class="theme-selector">
  <button class="theme-btn active" data-theme="light">Claro</button>
  <button class="theme-btn" data-theme="dark">Oscuro</button>
  <button class="theme-btn" data-theme="high-contrast">Alto Contraste</button>
  <button class="theme-btn" data-theme="safe">Accesibilidad</button>
</div>

<script>
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
      
      // Actualizar estado activo
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
</script>
```

## 📱 Responsive Design

El design system es completamente responsive. Los grids usan:

```css
/* Grid automático responsive */
.component-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 2rem;
}
```

## ♿ Accesibilidad

### Alto Contraste (WCAG AAA)

El tema `high-contrast` cumple con:
- Relación de contraste ≥ 7:1
- Bordes de 3px para mejor visibilidad
- Colores específicos para máxima legibilidad

### Modo Daltonismo (Okabe-Ito)

El tema `safe` usa la palette Okabe-Ito:
- Distinguible para todos los tipos de daltonismo
- Colores semánticos optimizados
- Contraste AA mínimo

## 🛠️ Integración con Frameworks

### React/Next.js

```jsx
// components/DesignSystemProvider.jsx
export default function DesignSystemProvider({ children }) {
  useEffect(() => {
    const theme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  return <>{children}</>;
}

// Uso en layout
<html lang="es" data-theme="light">
  <head>
    <link rel="stylesheet" href="/styles/apiflujos-ds.css" />
  </head>
  <body>
    <DesignSystemProvider>{children}</DesignSystemProvider>
  </body>
</html>
```

### Vue/Nuxt

```vue
<!-- plugins/design-system.client.js -->
export default defineNuxtPlugin(() => {
  onMounted(() => {
    const theme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  });
});
```

### Angular

```typescript
// app.module.ts
import { DESIGN_SYSTEM_CONFIG } from './design-system.config';

@NgModule({
  providers: [
    { provide: 'DESIGN_SYSTEM', useValue: DESIGN_SYSTEM_CONFIG }
  ]
})
```

## 📊 Ejemplos de Uso

Ver `examples/usage-examples.html` para ejemplos completos de:
- Dashboard administrativo
- Catálogo de productos
- Lista de contactos
- Formularios complejos
- Tablas de datos

## 🎯 Mejores Prácticas

1. **Siempre usar clases semánticas**: `btn-primary`, `pill-success`, etc.
2. **No modificar variables CSS directamente**: Usar overrides en tu proyecto
3. **Mantener accesibilidad**: No remover los temas de accesibilidad
4. **Usar íconos Lucide**: Son consistentes con el design system
5. **Respetar la jerarquía tipográfica**: H1 → H2 → H3 → p

## 🧭 Mapa de Oportunidades Estéticas

Para comenzar una base común de mejoras visuales, usa el mapa en:

`docs/OPORTUNIDADES_ESTETICAS.md`

## 📞 Soporte

Para issues o preguntas:
1. Revisar `docs/IMPLEMENTATION_GUIDE.md`
2. Consultar `docs/COMPONENT_REFERENCE.md`
3. Ver ejemplos en `examples/`

---

**ApiFlujos Design System** - v1.0.0
Creado con ❤️ para ApiFlujos
