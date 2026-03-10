# Prompts para IA - ApiFlujos Design System

## Índice

1. [Prompt Maestro para Implementación](#prompt-maestro-para-implementación)
2. [Prompts por Componente](#prompts-por-componente)
3. [Prompts para Páginas Completas](#prompts-para-páginas-completas)
4. [Prompts para Personalización](#prompts-para-personalización)
5. [Prompts para Debugging](#prompts-para-debugging)

---

## Prompt Maestro para Implementación

### Copia y pega este prompt para implementar cualquier cosa:

```
================================================================================
IMPLEMENTACIÓN CON APIFLUJOS DESIGN SYSTEM
================================================================================

CONTEXTO:
Estoy trabajando con ApiFlujos Design System, un sistema de diseño completo con:
- 4 temas: light (fondo blanco, módulos lila opcional), dark, high-contrast, safe
- Paleta Royal Purple como color de marca
- Componentes: botones, cards, product-cards, pills, formularios, listas, tablas
- Tipografía: Poppins (headings), Manrope (body)
- Íconos: Lucide
- Accesibilidad: WCAG AAA compliant

ARCHIVO DE REFERENCIA:
- apiflujos-design-system.html (contiene todos los estilos CSS)
- docs/COMPONENT_REFERENCE.md (documentación de componentes)
- docs/COLOR_PALETTE.md (paleta de colores completa)

REQUERIMIENTO:
[DESCRIBE AQUÍ LO QUE NECESITAS IMPLEMENTAR]

RESTRICCIONES:
1. Usa SIEMPRE las clases CSS del design system (.btn, .card, .pill, etc.)
2. Usa variables CSS (--primary, --bg-body, --text-heading, etc.)
3. Implementa para los 4 temas automáticamente
4. Usa íconos de Lucide: <i data-lucide="nombre-icono"></i>
5. Mantén accesibilidad (contraste AA mínimo, AAA ideal)
6. Responsive (mobile-first)

ESTRUCTURA DE CLASES DISPONIBLES:

Botones:
- .btn .btn-primary | .btn-outline | .btn-success | .btn-danger | .btn-secondary
- .btn-indigo | .btn-teal | .btn-amber | .btn-link-action
- Añadir is-lilac para fondo lila: .card.is-lilac

Cards:
- .card (estándar)
- .card.is-lilac (fondo lila suave)

Productos:
- .product-grid (contenedor)
- .product-card | .product-card.is-lilac
- .product-img | .product-body | .product-name | .product-price | .product-stock

Badges:
- .pill .pill-success | .pill-warning | .pill-error | .pill-info

Formularios:
- .input-group | .input-label | .input-control
- .input-with-icon (para inputs con ícono)

Listas:
- .list-card | .list-card.is-lilac
- .avatar | .contact-info | .contact-name | .contact-meta | .price

Utilidades:
- .container (max-width 1200px, centrado)
- .component-grid (grid responsive)
- .section-title (títulos de sección)
- .text-muted (texto atenuado)

COLORES PRINCIPALES:
- --royal-purple-50 a --royal-purple-950 (escala lila/morada)
- --primary: var(--royal-purple-700) en light mode
- --bg-body: #FFFFFF en light mode
- --bg-panel: #F8F9FA en light mode
- --success, --warning, --error, --info (semánticos)

EJEMPLO DE CÓDIGO ESPERADO:

<div class="container">
  <h2 class="section-title">Título</h2>
  <div class="component-grid">
    <div class="card is-lilac">
      <h3 style="color: var(--text-heading);">Contenido</h3>
      <button class="btn btn-primary">
        <i data-lucide="check"></i> Acción
      </button>
    </div>
  </div>
</div>

================================================================================
```

---

## Prompts por Componente

### Botones

```
Crea un grupo de botones usando ApiFlujos Design System.

Requisitos:
- Botón primario con ícono de guardar
- Botón outline para cancelar
- Botón success para confirmar
- Botón danger para eliminar
- Botón secundario para configuración

Usa las clases: .btn .btn-primary, .btn-outline, .btn-success, .btn-danger, .btn-secondary
Íconos de Lucide apropiados para cada acción.
```

### Cards

```
Diseña 3 cards de estadísticas usando ApiFlujos Design System.

Requisitos:
- Card 1: Ventas totales (con fondo lila is-lilac)
- Card 2: Productos activos (estándar)
- Card 3: Clientes nuevos (con fondo lila is-lilac)

Cada card debe incluir:
- Título con ícono
- Número grande (usar .product-price para tamaño)
- Pill con porcentaje de cambio (usar .pill .pill-success o .pill-info)

Usa variables CSS para colores (--text-heading, --text-muted, etc.)
```

### Productos

```
Crea un grid de 4 productos usando ApiFlujos Design System.

Requisitos:
- Producto 1: Básico (estándar)
- Producto 2: Premium (con fondo is-lilac, destacado)
- Producto 3: Servicio API (con advertencia de stock bajo)
- Producto 4: Enterprise (con badge "Más vendido")

Cada producto debe tener:
- Imagen con ícono de Lucide
- Nombre (.product-name)
- Precio (.product-price)
- Stock (.product-stock con ícono)
- Botón de acción

Usa .product-grid como contenedor y .product-card para cada item.
```

### Formularios

```
Diseña un formulario de contacto completo usando ApiFlujos Design System.

Campos requeridos:
- Nombre (input texto)
- Email (input email con ícono de mail)
- Teléfono (input tel con ícono de phone)
- Asunto (select)
- Mensaje (textarea)

Incluir:
- Labels apropiados (.input-label)
- Íconos en inputs relevantes (.input-with-icon)
- Botones de enviar y cancelar
- Validación visual (borde rojo para errores)

Usa .input-group, .input-label, .input-control, .input-with-icon
Envolver en .card para contenedor
```

---

## Prompts para Páginas Completas

### Dashboard Administrativo

```
Crea un dashboard administrativo completo usando ApiFlujos Design System.

Estructura requerida:
1. HEADER: Logo ApiFlujos + theme selector + usuario
2. STATS ROW: 4 cards de estadísticas (2 con is-lilac)
3. TABLA: Últimas transacciones (usar .payments-table)
4. GRID: Productos recientes (3-4 items)
5. LISTA: Clientes activos

Requisitos:
- Totalmente responsive
- Todos los temas soportados (light, dark, high-contrast, safe)
- Íconos de Lucide apropiados
- Usar variables CSS para todos los colores
- Incluir botón "Nueva transacción" (.btn-primary)
- Incluir badges de estado (.pill)

Referencia: Ver COMPONENT_REFERENCE.md para estructura de tablas y listas.
```

### Página de Producto/E-commerce

```
Crea una página de producto/e-commerce usando ApiFlujos Design System.

Secciones:
1. HEADER: Navegación + carrito + theme selector
2. BREADCRUMB: Inicio > Productos > Categoría > Producto
3. PRODUCT MAIN:
   - Imagen grande (placeholder con ícono)
   - Título H1
   - Precio grande
   - Descripción
   - Selector de cantidad
   - Botones: "Añadir al carrito" + "Comprar ahora"
4. INFO TABS: Descripción | Especificaciones | Reseñas
5. RELATED PRODUCTS: Grid de 4 productos relacionados

Requisitos:
- Usar .product-card para productos relacionados
- Botón primario para "Añadir al carrito"
- Botón link-action para "Comprar ahora"
- Pills para características (ej: "Envío gratis", "Garantía 2 años")
- Responsive mobile-first
```

### Página de Suscripciones/Precios

```
Crea una página de planes/suscripciones usando ApiFlujos Design System.

Estructura:
1. HEADER: Título + subtitle
2. PRICING GRID: 3 planes (Básico, Pro, Enterprise)
   - Plan del medio destacado con is-lilac y badge "Más popular"
   - Cada plan: nombre, precio, features list, botón
3. FAQ SECTION: Acordeón con preguntas frecuentes
4. CTA FINAL: "¿Listo para comenzar?"

Requisitos:
- Usar .card para cada plan
- Plan destacado: .card.is-lilac
- Features con checkmarks (.pill-success)
- Precios grandes (.product-price)
- Botones apropiados (.btn-primary, .btn-outline)
- Responsive (stack en móvil)
```

### Página de Contactos/CRM

```
Crea una página de gestión de contactos (CRM) usando ApiFlujos Design System.

Secciones:
1. TOOLBAR: 
   - Buscador (.input-with-icon con search)
   - Filtros (select)
   - Botón "Nuevo contacto" (.btn-primary)
2. CONTACT LIST: 
   - Múltiples .list-card
   - Algunos con .is-lilac para VIP
   - Avatar con iniciales
   - Info: nombre, email, teléfono
   - Estado (.pill)
   - Acciones: editar, eliminar
3. PAGINATION: Simple con botones

Requisitos:
- Usar .list-card para cada contacto
- Avatares con .avatar y iniciales
- Pills para estados (Activo, Inactivo, Pendiente)
- Hover effects automáticos
- Responsive (lista vertical en móvil)
```

---

## Prompts para Personalización

### Cambiar Color Primario

```
Personaliza ApiFlujos Design System cambiando el color primario.

Color actual: Royal Purple (#6d44a6)
Nuevo color: [TU_COLOR_AQUI, ej: #0066cc (azul)]

Requisitos:
1. Actualizar --primary y --primary-hover en todos los temas
2. Mantener la misma estructura de variables
3. Actualizar --primary-soft y --primary-text
4. Generar el CSS completo con los cambios
5. Verificar contraste en todos los temas

Proporciona el CSS modificado para:
- :root[data-theme="light"]
- :root[data-theme="dark"]
- :root[data-theme="high-contrast"]
- :root[data-theme="safe"]
```

### Añadir Nuevo Tema

```
Añade un nuevo tema "corporate" a ApiFlujos Design System.

Especificaciones del tema:
- Color primario: Azul corporativo (#1e40af)
- Fondo body: #f8fafc (gris muy claro)
- Fondo panel: #ffffff (blanco)
- Texto heading: #1e293b (gris oscuro)
- Texto body: #334155 (gris medio)
- Bordes: #e2e8f0 (gris claro)

Requisitos:
1. Crear :root[data-theme="corporate"] con todas las variables
2. Incluir colores semánticos apropiados
3. Mantener consistencia con otros temas
4. Añadir sombras apropiadas
5. Verificar contraste WCAG AA mínimo

Proporciona el bloque CSS completo del nuevo tema.
```

### Crear Variante de Card

```
Crea una nueva variante de card "card-elevated" para ApiFlujos Design System.

Especificaciones:
- Sombra más pronunciada (elevación)
- Sin borde visible
- Border-radius: 16px
- Hover: elevación aún mayor
- Soporte para is-lilac

Requisitos:
1. Definir .card-elevated con box-shadow grande
2. Añadir .card-elevated.is-lilac combinado
3. Hover state con transform: translateY(-4px)
4. Funcionar en todos los temas
5. Proporcionar ejemplo de uso

Genera el CSS completo y un ejemplo HTML.
```

---

## Prompts para Debugging

### Estilos No Se Aplican

```
PROBLEMA: Los estilos de ApiFlujos Design System no se aplican.

CÓDIGO ACTUAL:
[PEGAR TU HTML AQUÍ]

LO QUE HE INTENTADO:
- Verifiqué que el CSS está importado
- Revisé la ruta del archivo
- Limpié caché del navegador

DIAGNÓSTICO:
1. ¿El selector CSS es correcto?
2. ¿Hay conflictos de especificidad?
3. ¿El data-theme está configurado correctamente?
4. ¿Las variables CSS están definidas?

SOLUCIÓN:
Proporciona el código corregido y explica qué estaba mal.
```

### Tema No Cambia

```
PROBLEMA: El selector de temas no funciona.

CÓDIGO ACTUAL:
[PEGAR TU HTML/JS AQUÍ]

COMPORTAMIENTO ESPERADO:
- Al hacer clic en un botón de tema, debería cambiar
- El tema debería guardarse en localStorage
- Los botones deberían actualizar su estado "active"

DIAGNÓSTICO:
1. ¿El event listener está configurado correctamente?
2. ¿El atributo data-theme se está actualizando?
3. ¿localStorage está accesible?
4. ¿Los íconos se reinicializan?

SOLUCIÓN:
Proporciona el código JS corregido paso a paso.
```

### Bajo Contraste

```
PROBLEMA: El contraste es insuficiente en [TEMA/COMPONENTE].

ELEMENTOS AFECTADOS:
- [Describir elementos específicos]

CAPTURA/DESCRIPCIÓN:
[Describir el problema visual]

REQUISITO:
- Contraste mínimo WCAG AA (4.5:1 texto normal, 3:1 texto grande)
- Idealmente AAA (7:1)

SOLUCIÓN:
1. Identifica los colores problemáticos
2. Sugiere nuevos valores de variables
3. Proporciona el CSS corregido
4. Verifica el ratio de contraste resultante
```

---

## Prompt para Documentación

### Generar Documentación de Componente

```
Genera documentación completa para el componente [NOMBRE_COMPONENTE] de ApiFlujos Design System.

Incluir:
1. Descripción del componente y uso
2. Lista de clases CSS disponibles
3. Ejemplos de código HTML para cada variante
4. Variables CSS relacionadas
5. Estados (hover, active, disabled)
6. Ejemplos de personalización
7. Notas de accesibilidad
8. Compatibilidad con temas

Formato: Markdown con tablas y bloques de código.
Referencia: Seguir el estilo de docs/COMPONENT_REFERENCE.md
```

---

## Consejos para Mejores Resultados

1. **Sé específico**: Describe exactamente qué necesitas
2. **Proporciona contexto**: Menciona que usas ApiFlujos Design System
3. **Incluye restricciones**: Clases disponibles, variables, etc.
4. **Pide ejemplos**: Siempre solicita código HTML de ejemplo
5. **Verifica accesibilidad**: Pide confirmación de contraste WCAG
6. **Itera**: Si el resultado no es perfecto, refina el prompt

---

**ApiFlujos Design System - Prompts para IA v1.0**
