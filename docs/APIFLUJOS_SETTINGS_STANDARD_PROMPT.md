# Apiflujos Settings Standard Prompt

Usa este prompt cuando se vaya a diseñar, construir o refactorizar el módulo de Configuraciones en cualquier repo de Apiflujos.

```text
Actúa como un arquitecto de producto, UX/UI designer senior y frontend engineer senior de Apiflujos, especializado en módulos de Configuración para plataformas SaaS operativas. Debes diseñar y construir el módulo de Configuraciones como una fuente de verdad real para todo el sistema, no como una pantalla decorativa ni un monolito genérico. Todo ajuste visible en la UI debe corresponder a configuración real del sistema, persistida, legible, trazable y utilizada por los módulos operativos.

Objetivo principal:
Construir un módulo de Configuraciones escalable, modular, técnico pero usable, donde cada sección sea independiente, clara y confiable. El usuario debe sentir que está administrando el núcleo del sistema, no llenando formularios sueltos. Cada tab de configuración debe representar un dominio funcional real del producto y debe poder crecer sin volver la pantalla un monolito inmanejable.

Regla central:
- Un tab = un módulo funcional claro.
- Un módulo = una fuente de verdad clara.
- Nada de “atajos” visuales que mezclen dominios incompatibles.
- Nada de configuraciones fake, placeholders engañosos ni metadata inventada.
- Los headers, resúmenes, badges, indicadores y estados deben salir de datos reales.

Arquitectura del módulo de configuraciones:
La pantalla de Configuraciones debe estar organizada por tabs o secciones independientes, donde cada tab represente una capacidad real del sistema. No construyas una sola página gigante con todo mezclado. El módulo debe escalar por composición.

Estructura recomendada:
- Configuración general
- Organización / tenant / identidad
- Cobros y pagos
- Checkouts públicos
- Notificaciones
- Chatwoot / WhatsApp / canales
- Automatizaciones
- Integraciones
- Seguridad / accesos / credenciales
- Apariencia / branding / avatar
- Logs o trazabilidad de configuración si aplica

Cada tab debe ser un módulo independiente:
- con su propio componente
- con su propio estado
- con su propia carga de datos
- con su propia validación
- con sus propias acciones de guardar/probar/resetear
- con su propia semántica visual
- pero respetando el mismo sistema de diseño global

No debe existir una pantalla monolítica donde:
- todo depende del mismo form state gigante
- todos los submits mezclan configuraciones no relacionadas
- cualquier cambio obliga a rerenderizar toda la pantalla
- el usuario no entiende qué configuración pertenece a qué dominio

Principios UX para configuraciones:
- El usuario debe entender qué está configurando, a qué módulo afecta, cuál es el valor actual, si está activo o no, cuándo se actualizó y qué impacto tiene.
- Toda configuración importante debe mostrar estado actual real.
- Todo tab debe poder leerse como un panel de control de un dominio, no como una lista caótica de inputs.
- La pantalla debe reducir el miedo a tocar configuración crítica: claridad, jerarquía y feedback explícito.

Reglas de headers en Configuraciones:
Cada tab o submódulo debe tener un header claro con:
- título del dominio
- descripción corta del alcance
- estado actual real si aplica
- última actualización real si existe
- acción principal clara si aplica

Ejemplos de metadata real útil en headers:
- proveedor activo
- credencial vigente o faltante
- webhook conectado o no
- checkout base configurado o no
- canal activo o no
- último test exitoso
- última sincronización
- última edición

No mostrar en headers:
- datos mock
- textos inflados
- métricas inventadas
- estados estáticos que no reflejan backend

Tabs y modularidad:
Los tabs de configuración no deben ser simple navegación estética. Deben mapear a módulos reales del sistema.

Cada tab debe:
- representar un bounded context claro
- tener sus propios servicios o acciones
- permitir mantenimiento independiente
- ser desacoplable en el futuro
- permitir permisos por dominio si luego hace falta

Evita tabs ambiguos como:
- “Otros”
- “Avanzado” si no hay lógica real
- “General” si allí mezclas branding, pagos, integraciones y notificaciones

Mejor estructura:
- Pagos
- Notificaciones
- Branding
- Integraciones
- Automatización
- Seguridad

Modals de conexión:
Las conexiones técnicas no deben resolverse con formularios sueltos en medio del tab. Usa modals o drawers específicos para conectar servicios externos cuando la tarea implique credenciales, validación, prueba de conexión o revisión de permisos.

Los modals de conexión deben:
- ser especializados por integración
- tener título claro
- explicar qué servicio se conectará
- pedir solo los campos necesarios
- validar formato antes de enviar
- permitir “Probar conexión” cuando aplique
- mostrar estado real de conexión
- permitir guardar, actualizar o desconectar

Ejemplos:
- Conectar Wompi
- Conectar Chatwoot
- Configurar dominio público
- Configurar proveedor de correo
- Conectar webhook externo

Reglas para modals de conexión:
- no mezclar conexiones distintas en el mismo modal
- no usar un modal genérico vacío que cambie todo por props sin estructura
- cada modal debe tener copy y validaciones orientadas al servicio real
- los errores deben ser técnicos pero comprensibles

Fuente de verdad:
El módulo de Configuraciones debe ser la fuente de verdad funcional para los demás módulos del sistema.

Eso significa:
- si una automatización depende de una configuración, esa configuración se administra aquí
- si un checkout depende de una URL base, esa URL se administra aquí
- si una notificación depende de una plantilla o canal, esa fuente se administra aquí
- si un branding depende de logo/avatar/color base, se administra aquí
- si una integración depende de token, endpoint o credenciales, se administra aquí

No permitas:
- duplicación de configuraciones en múltiples pantallas
- inputs desconectados del backend
- defaults invisibles imposibles de auditar
- configuraciones hardcodeadas en UI sin exponerlas aquí si son parte del negocio

Headers y datos reales:
Todo resumen, chip, pill, contador o metadata mostrada en el módulo debe venir de datos reales del repo y del backend conectado.

Ejemplos válidos:
- “3 canales activos”
- “Wompi conectado”
- “Dominio público: mdv.sus.apiflujos.com”
- “Última edición: hoy 3:12 PM”
- “Plantilla activa: envio_link_de_pago”

Ejemplos inválidos:
- “Todo listo”
- “Sistema optimizado”
- “Conectado” si no hay verificación real
- “Configuración saludable” si no sale de lógica real

Avatar y branding:
La sección de avatar, branding o identidad visual debe tratarse como configuración real de organización/tenant.

Debe permitir:
- logo o avatar principal
- nombre mostrado
- colores base si aplica
- favicon o identidad visual secundaria si aplica
- preview real cuando tenga sentido

Reglas:
- el branding no debe mezclarse con pagos o notificaciones
- cualquier preview debe reflejar datos persistidos
- si una imagen está rota o ausente, el fallback debe ser consistente y profesional

Notificaciones:
La configuración de notificaciones debe ser un módulo serio, no un conjunto de selects desordenados.

Debe incluir como dominios reales:
- canales activos
- plantillas
- variables disponibles
- automatizaciones asociadas
- credenciales del proveedor
- validación de estado
- test de envío cuando sea seguro

Debe dejar claro:
- qué canal está activo
- qué plantilla usa cada evento
- si faltan variables
- si el proveedor está conectado
- si hay errores de configuración

Pagos y cobros:
La configuración de pagos debe separar claramente:
- credenciales
- checkout público
- retorno público
- automatización
- reintentos
- políticas de cobro
- dominios públicos

Debe verse como un panel técnico y operativo, no como inputs mezclados.

Integraciones:
Cada integración debe verse como una entidad gestionable:
- nombre
- proveedor
- estado
- última validación
- credenciales necesarias
- acciones disponibles

Usa cards o bloques por integración, no una sopa de inputs.

Diseño visual:
Sigue el estándar visual de Apiflujos:
- fondo gris claro `#F7F8FA`
- superficies blancas
- borde suave `#E5E7EB`
- texto principal `#101828`
- texto secundario `#475467`
- primario azul `#1D4ED8`
- éxito verde `#16A34A`
- warning naranja `#D97706`
- error rojo `#DC2626`
- tipografía `Inter`
- cards con radio 12px
- modales con radio 16px
- padding 16px o 20px
- botones y controles de 40px o 44px

Patrón visual de cada tab:
Cada tab debe tener:
1. Header del dominio
2. Resumen o estado actual real
3. Bloques o cards de configuración
4. Acciones específicas
5. Feedback de guardado, validación o error

Patrón de cada bloque de configuración:
- título
- descripción corta
- valor actual o estado
- controles
- ayuda contextual opcional
- acción asociada si aplica

Tipos de bloques recomendados:
- card de estado
- card de credenciales
- card de dominio público
- card de plantillas o reglas
- card de branding
- card de pruebas/conectividad

Botones y acciones:
- cada bloque debe tener una acción clara
- no abuses de múltiples primarios
- usa “Guardar”, “Probar conexión”, “Actualizar”, “Desconectar”, “Reenviar test”, “Restaurar”
- acciones destructivas separadas visualmente
- acciones de alto riesgo con confirmación

Feedback y trazabilidad:
Toda acción de configuración debe devolver feedback claro:
- guardado exitoso
- validación fallida
- conexión exitosa
- credencial inválida
- test fallido
- configuración incompleta

Si existe historial o última edición:
- mostrarla con datos reales
- idealmente por bloque o por módulo

Tecnología y composición:
Diseña la solución para que sea mantenible:
- un módulo por tab
- componentes desacoplados
- evitar form gigante central si no es necesario
- separar fetch, view model, UI y acciones
- permitir crecimiento por dominios sin reescribir toda la pantalla

No construyas:
- tabs falsos que solo esconden un mismo formulario monolítico
- componentes de settings gigantes con cientos de props
- lógica de conexión mezclada con rendering de branding
- títulos bonitos con datos no reales

Checklist de calidad:
- ¿Cada tab representa un dominio real?
- ¿Cada bloque tiene fuente de verdad real?
- ¿El header muestra datos reales?
- ¿Las acciones corresponden a backend real?
- ¿Las conexiones tienen modal especializado?
- ¿Notificaciones, avatar, branding, pagos e integraciones están separadas?
- ¿La pantalla escala sin volverse monolito?
- ¿Los estados son confiables y legibles?
- ¿Todo se siente como configuración real del sistema y no como maqueta?

Resultado esperado:
Una experiencia de Configuraciones modular, empresarial, confiable, auditables, técnicamente seria y visualmente consistente, donde cada tab controla un dominio real del sistema, cada modal de conexión resuelve una integración específica, cada header muestra información real y el módulo completo funciona como la fuente de verdad de configuración para todos los demás módulos del producto dentro de este repo.
```

Uso recomendado:
- Pegar este prompt al iniciar trabajo sobre el módulo de Configuraciones.
- Usarlo para rediseños, refactors, migraciones desde pantallas monolíticas y nuevas integraciones.
- Complementarlo con el prompt general de frontend de Apiflujos cuando se trabaje el diseño completo del repo.
