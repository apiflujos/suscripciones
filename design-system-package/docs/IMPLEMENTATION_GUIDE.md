# Guía de Implementación - ApiFlujos Design System

## Índice

1. [Introducción](#introducción)
2. [Arquitectura del Sistema](#arquitectura-del-sistema)
3. [Implementación Paso a Paso](#implementación-paso-a-paso)
4. [Personalización](#personalización)
5. [Solución de Problemas](#solución-de-problemas)
6. [Prompts para IA](#prompts-para-ia)

---

## Introducción

### ¿Qué es ApiFlujos Design System?

Es un sistema de diseño completo que incluye:
- **4 temas**: Claro, Oscuro, Alto Contraste, Accesibilidad (Daltonismo)
- **Componentes UI**: Botones, cards, formularios, tablas, badges
- **Paleta de colores**: Royal Purple con variaciones semánticas
- **Tipografía**: Poppins (headings) + Manrope (cuerpo)
- **Accesibilidad**: WCAG AAA compliant

### Filosofía de Diseño

1. **Fondo claro**: Blanco puro (#FFFFFF) para el tema claro
2. **Módulos en lila**: Gradientes suaves para destacar secciones
3. **Contraste alto**: Legibilidad prioritaria
4. **Consistencia**: Mismos patrones en todos los componentes

---

## Arquitectura del Sistema

### Estructura CSS

```css
/* 1. Variables de Marca (Colores base) */
:root {
  --royal-purple-50: #f9f7fd;
  /* ... más colores */
}

/* 2. Tema Claro */
:root[data-theme="light"] {
  --bg-body: #FFFFFF;
  --bg-panel: #F8F9FA;
  /* ... más variables */
}

/* 3. Tema Oscuro */
:root[data-theme="dark"] {
  /* ... variables oscuras */
}

/* 4. Alto Contraste */
:root[data-theme="high-contrast"] {
  /* ... variables alto contraste */
}

/* 5. Accesibilidad */
:root[data-theme="safe"] {
  /* ... variables daltonismo */
}

/* 6. Estilos Base */
* { box-sizing: border-box; }
body { /* ... */ }

/* 7. Componentes */
.btn { /* ... */ }
.card { /* ... */ }
/* ... más componentes */
```

### Jerarquía de Selectores

```
Especificidad CSS (menor a mayor):
1. Clase simple: .btn
2. Clase múltiple: .btn.btn-primary
3. Atributo + clase: :root[data-theme="light"] .btn
4. !important: (solo para overrides críticos)
```

---

## Implementación Paso a Paso

### Paso 1: Configurar HTML Base

```html
<!DOCTYPE html>
<html lang="es" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ApiFlujos App</title>
  
  <!-- Fuentes -->
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
  
  <!-- Íconos -->
  <script src="https://unpkg.com/lucide@latest"></script>
  
  <!-- Design System CSS -->
  <link rel="stylesheet" href="apiflujos-design-system.css">
  
  <!-- Inicialización de tema -->
  <script>
    (function() {
      try {
        const theme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', theme);
      } catch (e) {}
    })();
  </script>
</head>
<body>
  <!-- Contenido -->
  <script>
    // Inicializar íconos Lucide
    lucide.createIcons();
  </script>
</body>
</html>
```

### Paso 2: Extraer CSS del HTML

```bash
# Opción A: Usar el script automático
bash scripts/integrate-design-system.sh /ruta/proyecto

# Opción B: Manual
# 1. Abrir apiflujos-design-system.html
# 2. Copiar todo el contenido entre <style> y </style>
# 3. Guardar como apiflujos-design-system.css
```

### Paso 3: Crear Selector de Temas

```html
<div class="theme-selector">
  <button class="theme-btn active" data-theme="light">
    <i data-lucide="sun"></i> Claro
  </button>
  <button class="theme-btn" data-theme="dark">
    <i data-lucide="moon"></i> Oscuro
  </button>
  <button class="theme-btn" data-theme="high-contrast">
    <i data-lucide="contrast"></i> Alto Contraste
  </button>
  <button class="theme-btn" data-theme="safe">
    <i data-lucide="eye"></i> Accesibilidad
  </button>
</div>

<script>
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
      
      document.querySelectorAll('.theme-btn').forEach(b => 
        b.classList.remove('active')
      );
      btn.classList.add('active');
      
      // Reinicializar íconos si es necesario
      lucide.createIcons();
    });
  });
</script>
```

### Paso 4: Implementar Componentes

#### Ejemplo: Dashboard de Productos

```html
<div class="container">
  <!-- Header -->
  <header>
    <h1 class="brand-title">ApiFlujos <span>Dashboard</span></h1>
    <div class="theme-selector">
      <!-- Botones de tema -->
    </div>
  </header>

  <!-- Estadísticas -->
  <div class="component-grid">
    <div class="card is-lilac">
      <h3>Ventas Totales</h3>
      <p class="product-price">$12,450</p>
      <span class="pill pill-success">+15% vs mes anterior</span>
    </div>
    
    <div class="card">
      <h3>Productos Activos</h3>
      <p class="product-price">248</p>
      <span class="pill pill-info">3 nuevos esta semana</span>
    </div>
    
    <div class="card is-lilac">
      <h3>Clientes</h3>
      <p class="product-price">1,892</p>
      <span class="pill pill-success">+42 hoy</span>
    </div>
  </div>

  <!-- Catálogo -->
  <section>
    <h2 class="section-title">Productos Destacados</h2>
    <div class="product-grid">
      <div class="product-card is-lilac">
        <div class="product-img">
          <i data-lucide="package" size="48"></i>
        </div>
        <div class="product-body">
          <div class="product-name">Producto Premium</div>
          <div class="product-price">$99.00</div>
          <div class="product-stock">
            <i data-lucide="check-circle"></i> En Stock: 150
          </div>
          <button class="btn btn-primary">
            <i data-lucide="shopping-cart"></i> Añadir
          </button>
        </div>
      </div>
      
      <!-- Más productos... -->
    </div>
  </section>

  <!-- Lista de Clientes -->
  <section>
    <h2 class="section-title">Clientes Recientes</h2>
    <div class="product-list">
      <div class="product-list-item is-lilac">
        <div class="product-list-img">
          <i data-lucide="user"></i>
        </div>
        <div class="product-list-info">
          <strong>Juan Pérez</strong>
          <small>juan@email.com</small>
        </div>
        <div class="product-list-actions">
          <button class="btn btn-outline">Ver</button>
        </div>
      </div>
    </div>
  </section>
</div>
```

---

## Personalización

### Override de Variables

```css
/* En tu archivo CSS personalizado (después del design system) */

/* Cambiar el color primario */
:root[data-theme="light"] {
  --primary: #tu-color-personalizado;
  --primary-hover: #tu-color-hover;
}

/* Cambiar fondo de body */
:root[data-theme="light"] {
  --bg-body: #f5f5f5; /* En lugar de #FFFFFF */
}

/* Modificar sombras */
:root {
  --shadow-md: 0 8px 18px rgba(0, 0, 0, 0.12);
}
```

### Añadir Nuevos Componentes

```css
/* Nuevo tipo de botón */
.btn-gradient {
  background: linear-gradient(135deg, 
    var(--royal-purple-600), 
    var(--royal-purple-400)
  );
  color: white;
  border: none;
}

.btn-gradient:hover {
  filter: brightness(1.1);
}

/* Nueva variante de card */
.card-elevated {
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  border: none;
}
```

### Tema Personalizado

```css
/* Añadir un quinto tema */
:root[data-theme="corporate"] {
  --bg-body: #f8fafc;
  --bg-panel: #ffffff;
  --primary: #1e40af; /* Azul corporativo */
  /* ... más variables */
}
```

---

## Solución de Problemas

### Problema: Los estilos no se aplican

**Causa**: El CSS no está cargado correctamente

**Solución**:
```html
<!-- Verificar ruta del CSS -->
<link rel="stylesheet" href="./styles/apiflujos-design-system.css">

<!-- O usar inline (solo para testing) -->
<style>
  /* Copiar todo el CSS aquí */
</style>
```

### Problema: El tema no cambia

**Causa**: JavaScript no está inicializado

**Solución**:
```html
<script>
  // Asegurar que el DOM esté cargado
  document.addEventListener('DOMContentLoaded', () => {
    const theme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  });
</script>
```

### Problema: Los íconos no se ven

**Causa**: Lucide no está inicializado

**Solución**:
```html
<script src="https://unpkg.com/lucide@latest"></script>
<script>
  lucide.createIcons();
</script>
```

### Problema: Bajo contraste en modo claro

**Causa**: El fondo lila es muy oscuro

**Solución** (ya aplicada):
```css
:root[data-theme="light"] {
  --bg-body: #FFFFFF; /* Blanco puro */
  --bg-panel: #F8F9FA; /* Gris muy claro */
}
```

---

## Prompts para IA

### Prompt para Implementar Componente

```
Usa el ApiFlujos Design System para crear [COMPONENTE].

Requisitos:
1. Usa las clases CSS del design system (btn, card, pill, etc.)
2. Implementa los 4 temas (light, dark, high-contrast, safe)
3. Usa íconos de Lucide
4. Sigue la jerarquía tipográfica (Poppins para headings, Manrope para body)
5. Usa variables CSS (--primary, --bg-body, etc.)

Ejemplo de estructura:
<div class="card">
  <h3 class="section-title">Título</h3>
  <button class="btn btn-primary">Acción</button>
</div>

Referencia: apiflujos-design-system.html
```

### Prompt para Crear Página Completa

```
Crea una página [TIPO_DE_PAGINA] usando ApiFlujos Design System.

Especificaciones:
- Tema por defecto: light (fondo blanco, módulos en lila opcional)
- Incluir selector de temas en el header
- Usar componentes: [LISTA_DE_COMPONENTES]
- Responsive (mobile-first)
- Accesible (WCAG AA mínimo)

Estructura requerida:
1. Header con logo y theme selector
2. Main con grid de componentes
3. Footer con enlaces

Referencia visual: Ver apiflujos-design-system.html para ejemplos
```

### Prompt para Personalizar Colores

```
Personaliza el ApiFlujos Design System con estos cambios:

1. Color primario actual: [COLOR_ACTUAL] → [COLOR_NUEVO]
2. Fondo body: [COLOR_ACTUAL] → [COLOR_NUEVO]
3. Mantener los 4 temas (light, dark, high-contrast, safe)
4. Actualizar todas las variables relacionadas

Genera el CSS completo con los cambios aplicados a cada tema.
```

### Prompt para Debugging

```
El siguiente código no funciona con ApiFlujos Design System:

[PEGAR_CÓDIGO]

Problema observado: [DESCRIBIR_PROBLEMA]

Revisa:
1. Selectores CSS correctos
2. Variables CSS existentes
3. Jerarquía de especificidad
4. Conflictos con otros estilos

Proporciona la solución corregida.
```

---

## Checklist de Implementación

- [ ] HTML base configurado con `data-theme`
- [ ] CSS del design system importado
- [ ] Fuentes Google (Poppins + Manrope) cargadas
- [ ] Lucide icons script incluido
- [ ] Theme selector funcional
- [ ] localStorage para persistencia de tema
- [ ] Componentes usando clases correctas
- [ ] Responsive verificado en móvil
- [ ] Accesibilidad probada (alto contraste)
- [ ] Íconos renderizados correctamente

---

**Documentación creada para ApiFlujos Design System v1.0**
