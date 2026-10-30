# Plan integral: quitar los modales y pasar todo a páginas dedicadas

Estado: **propuesta, sin implementar**. Fecha: 2026-10-30.

## 1. Qué está mal (verificado en el código)

### 1.1 Los modales se montan dentro de la fila, no sobre la pantalla
`app/ui/AppModal.tsx` **no usa portal**: pinta el `modal-backdrop` donde se declara. En
la lista de suscripciones lo declara cada botón del kebab, o sea **dentro de la fila,
dentro del menú, dentro de `.settings-group-body` (`overflow-x: hidden`)**. Cualquier
ancestro con `overflow`, `transform` o su propio contexto de apilamiento recorta el
panel. Es la causa técnica de "la información se ve cortada".

`RowActionsMenu.tsx` lo confirma en su propio comentario: tuvo que dejar el menú
montado y solo ocultarlo (`hidden`) porque, si se desmonta, se lleva el modal abierto.

### 1.2 Cada fila monta ocho componentes de cliente
`BillingViewLista` pone por fila: detalle, cobro manual, marcar pago, desmarcar pago,
link de pago, tokenización, historial de pagos, cambio de producto y borrado. Con 31
suscripciones son unos 250 componentes de cliente con su estado, la mayoría para algo
que casi nadie abre. Es peso de render y de hidratación sin beneficio.

### 1.3 Tamaño del problema
- **48 usos de `<AppModal>` en 31 archivos.**
- Código de modales: ~7.300 líneas solo en los 9 archivos más grandes
  (`CustomersTable` 1.548, `ProductsTable` 1.240, `CheckoutTemplatesPanel` 1.005,
  `NotificationsSimple` 983, `BillingCyclesModal` 954, `SubscriptionDetailModal` 552…).
- Varios modales son **formularios largos o tablas de datos** (ciclos 954 líneas,
  historial de pagos, plantillas 900 px, crear suscripción 980 px). Eso no cabe en un
  modal: de ahí el scroll interno y el contenido cortado.

### 1.4 Scroll en las métricas de la lista — **por confirmar**
En `BillingPageContent` las métricas (`.billing-metrics`) están dentro de
`.settings-group`, junto a la lista. El CSS de `styles.css` tiene 18.000 líneas con
reglas que se pisan entre sí, así que no basta con leerlo: hay que **medir en el
navegador qué ancestro genera el scroll** (Fase 0).

## 2. Principios

1. **Cero modales.** Cada acción con contenido es una página con URL propia.
2. **La lista solo lista.** Sin estado de formularios ni modales por fila. El kebab
   pasa a ser un menú de **enlaces**.
3. **Volver donde estabas.** Todas las páginas reciben `returnTo` (ya existe en
   billing) y las server actions redirigen ahí; la lista conserva filtros y página.
4. **Una sola estructura de página** (`PageShell`): migas de pan, título, botón
   "Volver", contenido a ancho completo y barra de acciones fija abajo.
5. **Sin scroll interno** en listas ni métricas: el único scroll es el de la página.
6. **Confirmaciones sin overlay.** Acciones destructivas: confirmación en dos pasos
   dentro de la misma página ("¿Seguro?" → Confirmar / Cancelar), no una capa encima.
7. **Que no vuelvan.** Una prueba que falle si alguien importa `AppModal`.

## 3. Mapa de modales → páginas

### Suscripciones (`/billing`) — 13 modales
| Modal actual | Página nueva |
|---|---|
| Crear suscripción o cobro (`BillingModals`) | `/billing/new` |
| Detalle de suscripción | `/billing/[id]` (pestaña **Resumen**) |
| Ciclos / Pagos detectados / Buscar pago para asociar (`BillingCyclesModal`) | `/billing/[id]?tab=ciclos` y `?tab=pagos` |
| Historial de pagos | `/billing/[id]?tab=pagos` |
| Editar producto y facturación | `/billing/[id]/edit` |
| Cambiar producto | `/billing/[id]/change-product` |
| Canales de la suscripción | `/billing/[id]?tab=canales` |
| Enviar link de pago | `/billing/[id]/payment-link` |
| Enviar link de tokenización | `/billing/[id]/tokenization` |
| Cobro manual (+ estado del cobro, `ChargeStatusModal`) | `/billing/[id]/charge` (el resultado se muestra en la misma página) |
| Marcar / desmarcar pago manual | `/billing/[id]/mark-paid` |
| Crear contacto (desde el formulario de crear) | `/customers/new?returnTo=…` |

### Contactos (`/customers`) — 6 modales
Crear contacto → `/customers/new`. Editar contacto y Ficha → `/customers/[id]`
(ya existe; se le agregan pestañas). Crear suscripción o cobro →
`/customers/[id]/new-subscription`. Enviar link de pago / catálogo / débito
automático → `/customers/[id]/send/[link|catalog|token]`.

### Productos (`/products`) — 7 modales
Crear/editar producto → `/products/new`, `/products/[id]`. Crear suscripción desde
producto → `/products/[id]/new-subscription`. Enviar producto →
`/products/[id]/send`. Transacciones → `/products/[id]?tab=transacciones`.

### Otros
- **Plantillas de checkout:** `/checkout-templates/new`, `/checkout-templates/[id]`.
- **Campañas:** `/campaigns/new`, `/campaigns/[id]/run`.
- **Notificaciones:** el editor pasa a `/notifications/[id]`; los selectores de
  *Variables* y *Emojis* pasan a panel en línea (no a modal).
- **Logs/Pagos:** `/logs/payments/[id]/reconcile` y `/…/create-subscription`.
- **Empresas:** `/empresas/new` (la edición ya es página).
- **Ajustes:** `/settings/connections/[wompi|chatwoot|shopify]`,
  `/settings/webhooks/new`, `/settings/webhooks/[id]`, `/settings/redirects`.
- **Utilidades de lista:** *Importar CSV* → `/…/import`; *Filtros inteligentes* →
  panel en línea desplegable bajo la barra de la lista; *Mapa* → sección de la ficha.

## 4. Fases

### Fase 0 — Medir (medio día)
- Levantar la app con `npm run seed:local` y un navegador headless.
- Capturar `/billing?vista=lista` y localizar con `getComputedStyle` el ancestro de
  `.billing-metrics` que tiene `overflow` distinto de `visible`. Dejar el resultado y
  capturas antes/después en este documento.
- Listar cada modal con captura, para validar la tabla de la sección 3.

### Fase 1 — Base (1 día)
- Componente `PageShell` (migas, título, volver, barra de acciones fija).
- Convención de rutas y de `returnTo` en server actions.
- `RowActionsMenu` pasa a menú de **enlaces**; se elimina el truco de "montado/oculto".
- Prueba que falla si se importa `AppModal` en archivos migrados (lista que se vacía
  fase a fase).
- Arreglo del scroll de métricas detectado en la Fase 0.

### Fase 2 — Suscripciones (3–4 días) · **la que más duele**
Las 13 páginas de la sección 3. La página `/billing/[id]` con pestañas
(Resumen · Ciclos · Pagos · Canales) reemplaza los tres modales más pesados. Al
terminar, `BillingViewLista`, `BillingCard` y `BillingViewKanban` solo tienen un
componente de cliente por fila: el kebab.

### Fase 3 — Contactos y Productos (3 días)
Dividir `CustomersTable` (1.548) y `ProductsTable` (1.240) en tabla + páginas.

### Fase 4 — Plantillas, Campañas, Notificaciones, Logs, Empresas (2–3 días)

### Fase 5 — Ajustes (1–2 días)
Conexiones, Webhooks, Redirecciones.

### Fase 6 — Limpieza (medio día)
Borrar `AppModal`, `MapModal`, las reglas `.modal-*`/`.modal-panel` de `styles.css`,
el selector de modal en `GlobalLoader`, y actualizar
`docs/APIFLUJOS_FRONTEND_STANDARD_PROMPT.md` con la regla "sin modales".

**Total estimado: 11–14 días de trabajo.** Cada fase se publica por separado y deja la
app funcionando.

## 5. Criterios de aceptación (por fase)
- La acción abre una URL propia, se puede compartir y recargar sin perder el contexto.
- Nada queda cortado en pantalla de 1366 px ni en móvil de 390 px.
- No hay scroll interno en lista ni métricas.
- Tras guardar o cancelar se vuelve a la lista con filtros y página intactos.
- `npm run typecheck` y `npm test` en verde; sin imports de `AppModal` en lo migrado.

## 6. Riesgos
- **Server actions y CSRF:** cada página nueva debe recibir el token y el `returnTo`;
  se centraliza en `PageShell`.
- **Estado entre pasos** (por ejemplo, crear contacto dentro de crear suscripción):
  se resuelve con `returnTo` + `selectCustomerId`, que ya existe.
- **Archivos enormes:** dividirlos a la vez que se migra, no después.
- **CSS con reglas pisadas:** cada fase elimina sus reglas propias para no sumar más.

## 7. Decisiones que necesito
1. ¿Cero modales también para confirmaciones pequeñas y selectores (variables, emojis)?
   Propongo confirmación en dos pasos en la página y paneles en línea.
2. ¿Empezamos por **Suscripciones** (Fases 0–2)?
3. ¿Te sirve la página de suscripción con pestañas (Resumen, Ciclos, Pagos, Canales)?
