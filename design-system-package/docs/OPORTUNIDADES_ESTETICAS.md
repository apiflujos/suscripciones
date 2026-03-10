# Mapa de Oportunidades Estéticas

Este mapa define cómo identificar, priorizar y estandarizar oportunidades estéticas para construir una base coherente del design system.

## 1. Objetivo

Crear una ruta clara para convertir observaciones visuales en decisiones estandarizadas de diseño.

## 2. Insumos

- Capturas o referencias visuales del producto actual
- Contexto de uso: módulo, pantalla, usuario objetivo
- Restricciones: tema activo, accesibilidad, densidad
- Métrica de impacto: claridad, consistencia, confianza, eficiencia

## 3. Criterios de Oportunidad

- Inconsistencia visual respecto al design system
- Jerarquía visual confusa
- Falta de contraste o accesibilidad
- Exceso o déficit de densidad visual
- Uso no estándar de color, iconografía o tipografía
- Componentes duplicados con estilos divergentes

## 4. Flujo de Implementación

1. Detectar oportunidad en UI real
2. Clasificar el tipo de ajuste
3. Definir estándar objetivo
4. Probar en prototipo o HTML de referencia
5. Validar en temas clave
6. Documentar y publicar

## 5. Clasificación de Ajustes

- Tipografía
- Color y contraste
- Espaciado y densidad
- Iconografía
- Composición de layouts
- Estados de componentes
- Microinteracciones

## 6. Estándar Objetivo

Cada oportunidad debe terminar en:

- Regla visual explícita
- Ejemplo de implementación
- Si aplica: variable CSS, clase o token

## 7. Validación Estética

Checklist mínimo:

- Se ve consistente con el tema claro y oscuro
- No rompe accesibilidad
- Mantiene jerarquía visual
- Es coherente con el resto del sistema

## 8. Resultado Documentado

Agregar en uno de estos destinos:

- `docs/COMPONENT_REFERENCE.md`
- `docs/COLOR_PALETTE.md`
- Sección nueva si aplica

## 9. Formato de Registro

Usa este formato para registrar oportunidades:

```md
## [ID] Título breve
Contexto: pantalla o módulo
Problema: qué se percibe y por qué es un problema
Impacto: qué mejora y para quién
Propuesta: regla visual
Implementación: tokens / clases / ejemplos
Estado: propuesta | en prueba | validado | publicado
```

