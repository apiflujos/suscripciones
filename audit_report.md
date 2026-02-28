# Software Audit Report - GestionPro ERP
Fecha: 2026-02-27
Auditor: Antigravity Expert QA (15+ years exp.)
Estado: Finalizado

## Executive Summary
Overall score: 69.9%
Verdicto: Regular / Hacia bueno (alta capacidad de mejora en el corto plazo)

Top 3 findings:
1. Robustez funcional core sólida en inventario y facturación.
2. Debilidad crítica en seguridad de acceso por ausencia de MFA y manejo subóptimo de sesiones.
3. Degradación de rendimiento en reportes con bloqueos en PostgreSQL.

Critical risks:
- Seguridad: riesgo de fuerza bruta y secuestro de sesión.
- Disponibilidad: caída reciente de 2 horas evidencia falta de redundancia y recuperación.
- Rendimiento: reportes pesados degradan la experiencia y bloquean operaciones.

## Category Detail
Puntuaciones por categoría:
Funcionalidad     [████████████████░░░░] 84.0%
Usabilidad        [███████████░░░░░░░░░] 64.5%
Rendimiento       [████████████░░░░░░░░] 62.3%
Seguridad         [████████████░░░░░░░░] 62.3%
Calidad de Código [████████████░░░░░░░░] 61.5%
Confiabilidad     [██████████████░░░░░░] 69.3%

## Detailed Analysis (SWOT por categoría)
### Funcionalidad (Peso 30%, Puntaje 84%)
Strengths:
- Cobertura sólida de procesos core retail.
- Flujo de facturación estable.

Weaknesses:
- Manejo de errores inconsistente en frontend.
- Respuestas de error del API no estandarizadas.

Opportunities:
- Error Boundary global en React.
- Estandarización de errores y mensajes al usuario.

Threats:
- Errores no controlados pueden afectar operaciones críticas.

### Usabilidad y UX (Peso 20%, Puntaje 64.5%)
Strengths:
- Interfaz moderna tipo SaaS.

Weaknesses:
- Reportes pesados sin estados de carga ni progresos.

Opportunities:
- Carga progresiva y notificaciones para procesos largos.

Threats:
- Frustración del usuario y abandono en flujos críticos.

### Rendimiento (Peso 15%, Puntaje 62.3%)
Strengths:
- Code-splitting mejora carga inicial.

Weaknesses:
- Bloqueos PostgreSQL en reportes masivos.
- Índices faltantes en tablas históricas.

Opportunities:
- Réplicas de lectura y caching para consultas frecuentes.

Threats:
- Degradación general en horas pico.

### Seguridad (Peso 15%, Puntaje 62.3%)
Strengths:
- HTTPS y cifrado en reposo (RDS).

Weaknesses:
- Ausencia de MFA.
- JWT con expiración larga.

Opportunities:
- MFA con fricción baja para administrativos.
- Refresh tokens y reducción de TTL.

Threats:
- Ataques de fuerza bruta y secuestro de sesión.

### Calidad de Código (Peso 10%, Puntaje 61.5%)
Strengths:
- Estructura modular y legible.

Weaknesses:
- Cobertura de tests < 40%.
- Documentación técnica desactualizada.

Opportunities:
- CI/CD con cobertura mínima y OpenAPI.

Threats:
- Regresiones sin detección temprana.

### Confiabilidad (Peso 10%, Puntaje 69.3%)
Strengths:
- Backups automatizados.

Weaknesses:
- DR no probado.
- Alertas tardías.

Opportunities:
- Simulacros trimestrales y observabilidad.

Threats:
- Caídas prolongadas sin recuperación rápida.

## Risk Matrix (Actionable Items)
CRÍTICO: Implementar MFA y reducir TTL con refresh tokens.
ALTO: Optimizar reportes y separar lectura/escritura en PostgreSQL.
MEDIO: Subir cobertura de tests al 70% en lógica de negocio.
BAJO: Auditoría de accesibilidad y contraste.

## Improvement Roadmap
0-3 meses:
- MFA con fricción baja para panel administrativo.
- Auditoría de queries e índices faltantes.
- Observabilidad con dashboards y alertas tempranas.

3-6 meses:
- Redis para caching de sesiones y catálogos.
- Reportes asíncronos con notificación.
- Revisión del módulo predictivo sin impacto en DB productiva.

6-12 meses:
- Cobertura de tests >= 70%.
- UX en flujos complejos (RRHH).
- API pública con OpenAPI.

## Verification Plan
Manual verification:
- Validar pesos: Funcionalidad 30%, Usabilidad 20%, Rendimiento 15%, Seguridad 15%, Calidad 10%, Confiabilidad 10%.
- Revisar que los porcentajes sumen al 100% y el total 69.9%.
- Confirmar que los gráficos ASCII representen los porcentajes.
- Asegurar que los incidentes y quejas se reflejan:
  - Caída reciente de 2 horas.
  - Lentitud en reportes y bloqueos en PostgreSQL.
  - Ausencia de MFA y riesgo de sesión.

## MFA con baja fricción (Recomendación específica)
Principios:
- Aplicar MFA solo a roles administrativos y acciones sensibles.
- Usar “remember this device” por 30 días.
- Exigir MFA por riesgo (nuevo dispositivo, IP anómala, acceso fuera de horario).

Flujo recomendado:
- MFA opcional para usuarios operativos en primera fase.
- MFA obligatorio para SUPER_ADMIN y ADMIN.
- Fallback por email temporal solo para recuperación.

Métricas de fricción:
- Tasa de éxito en MFA.
- Tiempo promedio para completar login.
- Porcentaje de bloqueos por MFA fallido.

Nota: Ajustar umbrales de riesgo tras 2-4 semanas con telemetría.
