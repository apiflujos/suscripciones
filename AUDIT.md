# Auditoría Manual de Botones

## Alcance
- Revisión manual por módulo, vista y modal.
- Validación funcional, lógica, UI/UX y consistencia visual.

## Estado
- En curso.

## Plan de acción
1. Mapear cada módulo y sus vistas/modales con navegación manual.
2. Revisar cada botón en orden de prioridad (Pagos → Suscripciones → Contactos → Productos → Configuración → Notificaciones → Logs → resto).
3. Registrar hallazgos por vista/modal y corregir inmediatamente (UI/UX + lógica).
4. Repetir el barrido completo para verificar consistencia visual y funcional.

## Prioridad
1. Pagos
2. Suscripciones
3. Contactos
4. Productos
5. Configuración
6. Notificaciones
7. Logs / auditoría
8. Resto de módulos

## Formato de hallazgos
- Módulo / Vista / Modal
- Botón
- Comportamiento esperado
- Resultado actual
- Corrección aplicada
- Estado (OK / Pendiente)

## Avance
- Pagos: header estandarizado a 2 filas, acciones unificadas en una sola fila (import/export + recolectar + reconciliar), botones compactos y color uniforme. (En progreso)
- Suscripciones: botón "Ver" convertido a ícono (sin texto), card kanban clickeable sin botones extra. (En progreso)
- Suscripciones: corrección de fechas de ciclo/primer cobro para evitar desfase de día (timezone). (En progreso)
- Contactos: compactación adicional de card (menos gaps/padding, tags más compactos, botones sin desbordes). (En progreso)
- Modales: botones en footer estandarizados (altura 28, sin desborde). (En progreso)
- Productos: botones primarios de modales y formularios normalizados a tamaño compacto. (En progreso)
- Configuración: botones primarios normalizados a `btn-compact` en formularios y paneles. (En progreso)
- Notificaciones: botones del wizard estandarizados a tamaño compacto. (En progreso)
- Logs: botón principal del asistente AI ajustado a tamaño compacto. (En progreso)
- Resto de módulos: normalización global de botones primarios (incluye Super Admin, campañas, empresas, plantillas, páginas públicas). (En progreso)
- UI global: tamaños de botones/inputs unificados (28px), línea base de altura corregida.
- Iconografía: filtro y engranaje simplificados para uniformidad.
