# Paleta de Colores - ApiFlujos Design System

## Índice

1. [Royal Purple (Marca Principal)](#royal-purple-marca-principal)
2. [Colores Semánticos](#colores-semánticos)
3. [Variables por Tema](#variables-por-tema)
4. [Guía de Uso](#guía-de-uso)
5. [Accesibilidad](#accesibilidad)

---

## Royal Purple (Marca Principal)

La paleta Royal Purple es la identidad cromática de ApiFlujos. Consta de 11 tonos que van desde el lila más claro hasta el morado casi negro.

### Escala Completa

| Variable | Hex | RGB | Uso Recomendado |
|----------|-----|-----|-----------------|
| `--royal-purple-50` | `#f9f7fd` | `rgb(249, 247, 253)` | Fondos sutiles, hover suave |
| `--royal-purple-100` | `#f1edfa` | `rgb(241, 237, 250)` | Fondos de módulos lila |
| `--royal-purple-200` | `#e6def6` | `rgb(230, 222, 246)` | Bordes suaves, fondos |
| `--royal-purple-300` | `#d3c3ef` | `rgb(211, 195, 239)` | Elementos decorativos |
| `--royal-purple-400` | `#b89de3` | `rgb(184, 157, 227)` | Hover en tema oscuro |
| `--royal-purple-500` | `#9c77d5` | `rgb(156, 119, 213)` | Primary en tema oscuro |
| `--royal-purple-600` | `#8559c4` | `rgb(133, 89, 196)` | Hover states |
| `--royal-purple-700` | `#6d44a6` | `rgb(109, 68, 166)` | **Primary (tema claro)** |
| `--royal-purple-800` | `#5f3d8c` | `rgb(95, 61, 140)` | Primary hover |
| `--royal-purple-900` | `#4e3271` | `rgb(78, 50, 113)` | Textos destacados |
| `--royal-purple-950` | `#331a51` | `rgb(51, 26, 81)` | Text primary en claro |

### Visualización

```
████████████████████████████████████████
  50       100      200      300      400
████████████████████████████████████████
  500      600      700      800      900
████████████████████████████████████████
  950
```

### Gradientes Recomendados

```css
/* Gradiente Lila Suave (para cards is-lilac) */
background: linear-gradient(135deg, 
  var(--royal-purple-100) 0%, 
  var(--royal-purple-50) 100%
);

/* Gradiente Primary */
background: linear-gradient(135deg, 
  var(--royal-purple-600) 0%, 
  var(--royal-purple-500) 100%
);

/* Gradiente Oscuro */
background: linear-gradient(135deg, 
  var(--royal-purple-800) 0%, 
  var(--royal-purple-700) 100%
);
```

---

## Colores Semánticos

Los colores semánticos comunican estados y acciones específicas.

### Success (Éxito)

| Tema | Variable | Valor | Uso |
|------|----------|-------|-----|
| Light | `--success` | `#008561` | Botones, badges |
| Light | `--success-bg` | `#e6fcf5` | Fondos de alertas |
| Dark | `--success` | `#63e6be` | Versión brillante |
| Dark | `--success-bg` | `rgba(0, 158, 115, 0.2)` | Fondo semitransparente |
| HC | `--success` | `#00ff00` | Verde puro |
| Safe | `--success` | `#009E73` | Okabe-Ito |

```html
<span class="pill pill-success">Completado</span>
<button class="btn btn-success">Confirmar</button>
```

### Warning (Advertencia)

| Tema | Variable | Valor | Uso |
|------|----------|-------|-----|
| Light | `--warning` | `#bf8500` | Botones, badges |
| Light | `--warning-bg` | `#fff9db` | Fondos de alertas |
| Dark | `--warning` | `#ffd43b` | Versión brillante |
| Dark | `--warning-bg` | `rgba(230, 159, 0, 0.2)` | Fondo semitransparente |
| HC | `--warning` | `#ffff00` | Amarillo puro |
| Safe | `--warning` | `#E69F00` | Okabe-Ito |

```html
<span class="pill pill-warning">Pendiente</span>
```

### Error (Error/Danger)

| Tema | Variable | Valor | Uso |
|------|----------|-------|-----|
| Light | `--error` | `#d44000` | Botones, badges |
| Light | `--error-bg` | `#fff5f5` | Fondos de alertas |
| Dark | `--error` | `#ff8787` | Versión brillante |
| Dark | `--error-bg` | `rgba(213, 94, 0, 0.2)` | Fondo semitransparente |
| HC | `--error` | `#ff0000` | Rojo puro |
| Safe | `--error` | `#D55E00` | Okabe-Ito (Vermilion) |

```html
<span class="pill pill-error">Error</span>
<button class="btn btn-danger">Eliminar</button>
```

### Info (Información)

| Tema | Variable | Valor | Uso |
|------|----------|-------|-----|
| Light | `--info` | `#0076b2` | Botones, badges |
| Light | `--info-bg` | `#e7f5ff` | Fondos de alertas |
| Dark | `--info` | `#74c0fc` | Versión brillante |
| Dark | `--info-bg` | `rgba(86, 180, 233, 0.2)` | Fondo semitransparente |
| HC | `--info` | `#00ffff` | Cyan puro |
| Safe | `--info` | `#56B4E9` | Okabe-Ito (Sky Blue) |

```html
<span class="pill pill-info">Info</span>
```

---

## Variables por Tema

### Tema Claro (Light)

```css
:root[data-theme="light"] {
  /* Fondos */
  --bg-body: #FFFFFF;           /* Blanco puro */
  --bg-panel: #F8F9FA;          /* Gris muy claro */
  --bg-hover: var(--royal-purple-50);
  
  /* Textos */
  --text-heading: var(--apf-ink-950);  /* #0C0F1A */
  --text-body: var(--apf-ink-900);     /* #1B1022 */
  --text-muted: var(--apf-slate-600);  /* #5B6070 */
  
  /* Bordes */
  --border-soft: rgba(15, 23, 42, 0.08);
  --border-hard: rgba(15, 23, 42, 0.15);
  
  /* Primary */
  --primary: var(--royal-purple-700);  /* #6d44a6 */
  --primary-hover: var(--royal-purple-800);
  --primary-soft: var(--royal-purple-100);
  --primary-text: var(--royal-purple-950);
  
  /* Sombras */
  --shadow-sm: 0 2px 4px rgba(30, 18, 52, 0.04);
  --shadow-md: 0 8px 18px rgba(30, 18, 52, 0.08);
}
```

### Tema Oscuro (Dark)

```css
:root[data-theme="dark"] {
  /* Fondos */
  --bg-body: #0a0510;           /* Casi negro con tinte morado */
  --bg-panel: #160e22;          /* Morado muy oscuro */
  --bg-hover: #261638;          /* Morado oscuro */
  
  /* Textos */
  --text-heading: #f9f7fd;      /* Blanco con tinte lila */
  --text-body: #e6def6;         /* Lila claro */
  --text-muted: #b89de3;        /* Lila medio */
  
  /* Bordes */
  --border-soft: rgba(255, 255, 255, 0.1);
  --border-hard: rgba(255, 255, 255, 0.2);
  
  /* Primary */
  --primary: var(--royal-purple-500);  /* #9c77d5 */
  --primary-hover: var(--royal-purple-400);
  --primary-soft: rgba(156, 119, 213, 0.15);
  --primary-text: var(--royal-purple-50);
  
  /* Sombras */
  --shadow-sm: 0 2px 4px rgba(0,0,0, 0.5);
  --shadow-md: 0 8px 18px rgba(0,0,0, 0.5);
}
```

### Alto Contraste (High Contrast)

```css
:root[data-theme="high-contrast"] {
  /* Fondos */
  --bg-body: #000000;           /* Negro puro */
  --bg-panel: #000000;
  --bg-hover: #000000;
  
  /* Textos */
  --text-heading: #ffffff;      /* Blanco puro */
  --text-body: #ffffff;
  --text-muted: #cccccc;
  
  /* Bordes */
  --border-soft: #ffff00;       /* Amarillo puro */
  --border-hard: #ffff00;
  
  /* Primary */
  --primary: #ffff00;           /* Amarillo puro */
  --primary-hover: #ffffff;     /* Blanco */
  --primary-soft: #000000;
  --primary-text: #000000;
  
  /* Extra Colors (WCAG AAA) */
  --hc-extra-1: #e8d5ff;        /* Purple pastel */
  --hc-extra-2: #b3e5ff;        /* Sky pastel */
  --hc-extra-3: #7dffd4;        /* Teal brillante */
  --hc-extra-5: #ff9e80;        /* Coral brillante */
  --hc-extra-6: #ffb3e6;        /* Pink brillante */
  
  /* Bordes */
  --hc-border-width: 3px;
}
```

### Accesibilidad (Safe / Daltonismo)

```css
:root[data-theme="safe"] {
  /* Fondos */
  --bg-body: #ffffff;           /* Blanco */
  --bg-panel: #f8fafc;          /* Gris muy claro */
  --bg-hover: #e2e8f0;
  
  /* Textos */
  --text-heading: #000000;      /* Negro puro */
  --text-body: #000000;
  --text-muted: #4b5563;
  
  /* Bordes */
  --border-soft: #cbd5e1;
  --border-hard: #94a3b8;
  
  /* Primary (Okabe-Ito Blue) */
  --primary: #0072B2;
  --primary-hover: #005f9e;
  --primary-soft: #e0f2fe;
  --primary-text: #ffffff;
  
  /* Extra Colors (Optimizados para Daltonismo) */
  --safe-extra-1: #351c75;      /* Púrpura oscuro */
  --safe-extra-2: #073763;      /* Azul marino */
  --safe-extra-3: #274e13;      /* Verde bosque */
  --safe-extra-4: #783f04;      /* Marrón */
  --safe-extra-5: #741b47;      /* Magenta oscuro */
  --safe-extra-6: #CC79A7;      /* Reddish Purple */
  --safe-extra-7: #000000;      /* Negro */
}
```

---

## Guía de Uso

### Cuándo Usar Cada Color

#### Royal Purple

| Tono | Caso de Uso | Ejemplo |
|------|-------------|---------|
| 50-100 | Fondos de módulos, hover | `.card.is-lilac` |
| 200-300 | Bordes decorativos | Separadores |
| 400-500 | Tema oscuro primary | Botones en dark mode |
| 600-700 | **Primary principal** | Botones en light mode |
| 800-900 | Hover, textos | `:hover` states |
| 950 | Texto más oscuro | Headings |

#### Colores Semánticos

| Color | Caso de Uso | Ejemplo |
|-------|-------------|---------|
| Success | Confirmaciones, éxitos | "Guardado correctamente" |
| Warning | Advertencias, pendientes | "Revisar antes de continuar" |
| Error | Errores, acciones destructivas | "Eliminar cuenta" |
| Info | Información neutra | "Nuevo feature disponible" |

### Combinaciones Recomendadas

```css
/* Card destacada con gradiente */
.card-destacada {
  background: linear-gradient(135deg, 
    var(--royal-purple-100), 
    var(--royal-purple-50)
  );
  border: 1px solid var(--royal-purple-200);
}

/* Botón primario con sombra */
.btn-primary-custom {
  background: var(--royal-purple-700);
  box-shadow: 0 4px 12px rgba(109, 68, 166, 0.3);
}

/* Alerta de éxito */
.alert-success {
  background: var(--success-bg);
  border: 1px solid var(--success);
  color: var(--success);
}
```

### Contraste Mínimo (WCAG)

| Combinación | Ratio | Nivel |
|-------------|-------|-------|
| `--text-heading` sobre `--bg-body` (light) | 16.1:1 | AAA |
| `--text-body` sobre `--bg-panel` (light) | 15.2:1 | AAA |
| `--primary` sobre `--bg-body` (light) | 5.8:1 | AA |
| Blanco sobre `--primary` | 5.8:1 | AA |
| `--text-heading` sobre `--bg-body` (dark) | 16.5:1 | AAA |
| `--text-body` sobre `--bg-panel` (dark) | 12.3:1 | AAA |

---

## Accesibilidad

### Daltonismo

La paleta Safe usa Okabe-Ito, diseñada específicamente para:
- **Protanopia** (insensibilidad al rojo)
- **Deuteranopia** (insensibilidad al verde)
- **Tritanopia** (insensibilidad al azul)

### Alto Contraste

El tema HC cumple WCAG AAA:
- Contraste mínimo 7:1 para texto normal
- Contraste mínimo 4.5:1 para texto grande
- Bordes de 3px para elementos interactivos

### Herramientas Recomendadas

1. **WebAIM Contrast Checker**: https://webaim.org/resources/contrastchecker/
2. **Color Oracle**: Simulador de daltonismo
3. **axe DevTools**: Auditoría de accesibilidad

---

## Export para Otros Formatos

### JSON (para Tailwind, etc.)

```json
{
  "royalPurple": {
    "50": "#f9f7fd",
    "100": "#f1edfa",
    "200": "#e6def6",
    "300": "#d3c3ef",
    "400": "#b89de3",
    "500": "#9c77d5",
    "600": "#8559c4",
    "700": "#6d44a6",
    "800": "#5f3d8c",
    "900": "#4e3271",
    "950": "#331a51"
  },
  "semantic": {
    "success": "#008561",
    "warning": "#bf8500",
    "error": "#d44000",
    "info": "#0076b2"
  }
}
```

### SCSS Variables

```scss
$royal-purple-50: #f9f7fd;
$royal-purple-100: #f1edfa;
$royal-purple-200: #e6def6;
$royal-purple-300: #d3c3ef;
$royal-purple-400: #b89de3;
$royal-purple-500: #9c77d5;
$royal-purple-600: #8559c4;
$royal-purple-700: #6d44a6;
$royal-purple-800: #5f3d8c;
$royal-purple-900: #4e3271;
$royal-purple-950: #331a51;

$success: #008561;
$warning: #bf8500;
$error: #d44000;
$info: #0076b2;
```

---

**ApiFlujos Design System - Paleta de Colores v1.0**
