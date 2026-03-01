Gamificacion, KPI y Ranking (Global + Canal)
============================================

Estado: Propuesta base aprobada por el usuario (pendiente de implementacion).

Objetivo
--------
Construir un sistema de gamificacion con ranking GLOBAL y por CANAL (tenant),
con actualizacion realtime, que sea sostenible 15-20 anos, sin techo de puntos,
pero con niveles (20 max) que pueden subir o bajar segun constancia.

Principios
----------
- Puntos sin techo: el progreso historico nunca se pierde.
- Nivel = constancia actual: puede subir o bajar.
- Global + canal: reglas globales aplican a todos los canales; un canal puede
  agregar reglas adicionales.
- Realtime primero: pagos y acciones clave actualizan score en tiempo real.
- Transparencia: cada cambio queda en el timeline de eventos.

Entidades con ranking
---------------------
- Contactos (Customer).
- Productos/Servicios (SubscriptionPlan con metadata.kind = CATALOG_ITEM).
- Opcional: Planes/Suscripciones como categoria de negocio separada.
- Operaciones (jobs): ranking operativo separado (no mezclado con cliente).

Modelos propuestos (nuevas tablas)
----------------------------------
1) GamificationEvent
   - id, entityType (customer|product|job), entityId, tenantId (nullable para global)
   - kind, delta (positivo/negativo), points, moneyCents, metadata, createdAt

2) GamificationScore
   - id, entityType, entityId, tenantId (nullable para global)
   - lifetimePoints (solo suma)
   - statusScore (sube/baja)
   - level (1..20)
   - lastActivityAt, lastPaymentAt
   - streaks (consistencia)
   - dataQualityScore
   - recencyScore
   - monetaryScore
   - updatedAt

3) GamificationRewardLedger (opcional)
   - id, customerId, tenantId (nullable), pointsEarned, pointsRedeemed, balance
   - refEventId, createdAt

Scoring sin techo (modelo dual)
-------------------------------
1) lifetimePoints
   - Solo suma con cada evento positivo.
   - Nunca baja.
   - Muestra "historial ganado".

2) statusScore (nivel actual)
   - Sube con actividad y valor economico.
   - Baja por inactividad o acciones negativas.
   - Determina el nivel (1..20).

Formula por canal (requerida)
-----------------------------
score_canal = (score_global * factor_canal) + bonus_canal

Donde:
- score_global: calculado con reglas globales (aplica a todos los canales).
- factor_canal: ponderador del canal (ej. 0.8 - 1.2).
- bonus_canal: reglas adicionales del canal (eventos locales).

Niveles (20 max, sin techo de puntos)
-------------------------------------
Propuesta de nombres (ajustables):
  1. Rookie
  2. Aprendiz
  3. Bronce I
  4. Bronce II
  5. Plata I
  6. Plata II
  7. Oro I
  8. Oro II
  9. Platino I
 10. Platino II
 11. Diamante I
 12. Diamante II
 13. Elite I
 14. Elite II
 15. Maestro I
 16. Maestro II
 17. Legendario I
 18. Legendario II
 19. Icono
 20. Icono Supremo

Regla clave:
- lifetimePoints no baja.
- level se calcula por statusScore y puede subir/bajar.

KPI y componentes de score
--------------------------
Componentes sugeridos para statusScore (ponderables):
- monetaryScore: valor economico (pagos aprobados, monto).
- activityScore: actividad (mensajes, acciones en plataforma).
- consistencyScore: constancia (streak de meses, puntualidad).
- dataQualityScore: calidad de datos del contacto.
- recencyScore: actividad reciente (ventanas 24h/7d/30d).
- penaltyScore: mora, fallos, cancelaciones.

Ejemplo de composicion (ajustable):
statusScore = (monetaryScore * 0.45)
            + (consistencyScore * 0.20)
            + (activityScore * 0.15)
            + (dataQualityScore * 0.10)
            + (recencyScore * 0.10)
            - (penaltyScore)

Eventos (mapa base)
------------------
Eventos de Contacto (Customer)
- payment.approved         => + puntos (alto peso)
- payment.failed           => - puntos
- subscription.started     => + puntos
- subscription.renewed     => + puntos
- subscription.canceled    => - puntos
- subscription.past_due    => - puntos (moderado)
- chatwoot.message_in      => + puntos (si hay interaccion real)
- chatwoot.response_click  => + puntos (si responde a mensaje o link)
- data.email_added         => + puntos
- data.phone_added         => + puntos
- data.id_added            => + puntos
- inactivity.30d           => - puntos

Eventos de Producto/Servicio (SubscriptionPlan CATALOG_ITEM)
- product.payment.approved => + puntos (alto peso)
- product.payment.failed   => - puntos
- product.inquiry.chatwoot  => + puntos (interes)
- product.refund/chargeback => - puntos (alto)
- product.trend.24h/7d/30d  => + puntos (tendencia)

Eventos de Jobs (operaciones)
- job.succeeded            => + puntos (por impacto)
- job.failed               => - puntos
- job.sync.customers       => + puntos (si mejora calidad de data)
- job.sync.products        => + puntos

Ventanas mixtas (tendencia)
---------------------------
- 24h  => "calor" inmediato
- 7d   => traccion real
- 30d  => consistencia

Top 3 tendencias (por canal y global)
-------------------------------------
- Top 3 contactos en tendencia (24h/7d/30d).
- Top 3 productos en tendencia (24h/7d/30d).
- Visibles siempre y linkeables a listas inteligentes.

Inactividad y degradacion
-------------------------
- Inactividad NO toca lifetimePoints.
- Inactividad baja statusScore con decaimiento progresivo.

Ejemplo (ajustable):
- Sin pago aprobado en 30 dias: -X% semanal.
- Sin actividad (chatwoot o acciones) en 14 dias: -Y puntos.

Consistencia (streaks)
----------------------
- Streak mensual: + puntos por cada mes consecutivo con pago aprobado.
- Penalidad suave si se rompe streak (no borra lifetimePoints).

Calidad de datos
----------------
Puntaje por campos:
- email valido
- telefono
- identificacion
- direccion completa

Estas mejoras elevan dataQualityScore y el ranking del contacto.

Realtime y jobs
---------------
- Realtime: cada evento clave dispara recalculo inmediato.
- Job horario: tendencias (24h/7d/30d), ajustes de recencyScore.
- Job diario: recalculo completo y degradacion por inactividad.

Integracion con la app existente
--------------------------------
- SmartLists: agregar campos de gamificacion (level, statusScore, trend).
- SmartViews: campos globales + por canal.
- SSE actual (apps/admin/app/api/realtime/route.ts): extender con eventos de
  gamificacion para actualizar UI en tiempo real.

Reglas globales + reglas por canal
----------------------------------
- Global: aplica a todos los canales.
- Canal: agrega reglas locales (bonus_canal y/o factor_canal).

Notas de implementacion (sin cambios aun)
-----------------------------------------
- Todo cambio debe ser incremental y no destructivo.
- No se elimina data historica.
- El timeline de eventos es obligatorio para auditoria.

