# Estándar de Encabezados - UI Consistente

## Estructura Base (2 filas máximo)

```
┌─────────────────────────────────────────────────────────────────┐
│ Fila 1: [Título] [Ayuda]              [Contadores/Pills]        │
├─────────────────────────────────────────────────────────────────┤
│ Fila 2: [Búsqueda] [Filtros]          [Acciones/Derecha]        │
└─────────────────────────────────────────────────────────────────┘
```

## Reglas:

1. **MÁXIMO 2 FILAS** - No más de 2 filas horizontales
2. **Título único** - Sin duplicados, sin subtítulos redundantes
3. **Altura consistente** - 36px min-height para headers
4. **Tipografía uniforme**:
   - Título: 14px, font-weight 600
   - Labels: 12px, font-weight 500
   - Hints: 11px, color muted

## Componentes por Página:

### Lista (Customers, Products, Empresas)
```
Fila 1: [Título]                      [Importar/Exportar]
Fila 2: [Búsqueda] [Smart Lists]      [Crear Nuevo]
```

### Métricas/Pagos
```
Fila 1: [Título]                      [Pills de estado]
Fila 2: [Periodo] [Canal] [Desde] [Hasta]
```

### Configuración
```
Fila 1: [Título de sección]
Fila 2: [Contenido...]
```

### Modales
```
Header: [Título]                      [X Cerrar]
Body:   [Contenido...]
```

## NO PERMITIDO:

❌ Doble título (título + subtítulo redundante)
❌ Más de 2 filas
❌ Texto suelto sin contenedor
❌ Títulos de diferente tamaño en la misma página
❌ Iconos sin tooltip
❌ Botones sin label claro

## CLASES CSS:

```css
.panel-header { 
  display: flex; 
  align-items: center; 
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 8px 12px;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
```
