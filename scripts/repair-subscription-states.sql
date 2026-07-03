-- ============================================================================
-- REPARACIÓN DE ESTADOS DE SUSCRIPCIÓN (para correr en PRODUCCIÓN)
-- Motor: PostgreSQL. Tablas en PascalCase entre comillas (default de Prisma).
-- ----------------------------------------------------------------------------
-- REGLA ACORDADA:
--   * Todos los ciclos ANTERIORES a junio 2026 se dan por PAGADOS (backlog saldado).
--   * Los ciclos de JUNIO 2026 NO se marcan en bloque: solo quedan PAID los que
--     tengan un pago 'APPROVED' real. Los demás de junio quedan PENDING (en mora).
--   * Los ciclos FUTUROS (jul/ago/sep…) no se tocan salvo que tengan pago real;
--     quedan PENDING de forma natural (aún no vencen).
--   * "junio" se identifica por el PERIODO del ciclo (periodStartAt), no por dueAt.
--   * Luego se recalcula el status de la suscripción:
--       - EN MORA (PAST_DUE) si queda algún ciclo cobrable ('PENDING'/'FAILED')
--         vencido hace MÁS de graceDays días.
--       - AL DÍA (ACTIVE) en caso contrario.
--       - No se tocan CANCELED / EXPIRED / SUSPENDED.
--
-- ORDEN: 1) corre los PREVIEW (A y B).  2) corre el bloque BEGIN..COMMIT.
--        3) revisa filas afectadas y haz COMMIT (o ROLLBACK).
--
-- graceDays: se usa la columna por suscripción "graceDays".
-- Frontera de junio: periodStartAt en [2026-06-01, 2026-07-01).
-- ============================================================================


-- ============================================================================
-- A) PREVIEW — Ciclos de JUNIO y su situación de pago (los que NO tengan pago
--    aprobado quedarán PENDING = en mora).
-- ============================================================================
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM "Payment" p
    WHERE p."subscriptionId"=c."subscriptionId" AND p."cycleNumber"=c."cycleNumber"
      AND p.status='APPROVED'
  ) THEN 'JUNIO con pago -> PAID' ELSE 'JUNIO sin pago -> queda PENDING' END AS resultado,
  COUNT(*) AS ciclos
FROM "SubscriptionBillingCycle" c
WHERE c.status IN ('PENDING','FAILED')
  AND c."periodStartAt" >= DATE '2026-06-01'
  AND c."periodStartAt" <  DATE '2026-07-01'
GROUP BY 1;

-- ============================================================================
-- B) PREVIEW — Distribución del status de suscripción que quedaría DESPUÉS.
--    (Trata como pagados: todo lo anterior a junio + junio con pago aprobado.)
-- ============================================================================
SELECT
  s.status AS estado_actual,
  CASE WHEN EXISTS (
      SELECT 1 FROM "SubscriptionBillingCycle" c
      WHERE c."subscriptionId"=s.id
        AND c.status IN ('PENDING','FAILED')
        AND c."dueAt" < NOW() - (s."graceDays"*INTERVAL '1 day')
        -- excluye lo que quedará PAID: anteriores a junio, o junio con pago aprobado
        AND NOT (
          c."periodStartAt" < DATE '2026-06-01'
          OR EXISTS (SELECT 1 FROM "Payment" p
                     WHERE p."subscriptionId"=c."subscriptionId"
                       AND p."cycleNumber"=c."cycleNumber" AND p.status='APPROVED')
        )
    ) THEN 'PAST_DUE' ELSE 'ACTIVE' END AS estado_esperado,
  COUNT(*) AS cantidad
FROM "Subscription" s
WHERE s.status IN ('ACTIVE','PAST_DUE')
GROUP BY 1,2 ORDER BY 1,2;


-- ============================================================================
-- APLICAR — todo en una transacción. Revisa los conteos y luego COMMIT.
-- ============================================================================
BEGIN;

-- ── PASO 1: reconciliar cualquier ciclo con pago 'APPROVED' -> PAID ─────────
--    (aplica a junio y a cualquier mes; usa el pago real)
WITH pago AS (
  SELECT DISTINCT ON (p."subscriptionId", p."cycleNumber")
         p.id AS payment_id, p."subscriptionId", p."cycleNumber", p."paidAt"
  FROM "Payment" p
  WHERE p.status='APPROVED' AND p."cycleNumber" IS NOT NULL
  ORDER BY p."subscriptionId", p."cycleNumber", p."paidAt" DESC NULLS LAST
)
UPDATE "SubscriptionBillingCycle" c
SET status='PAID',
    "paidAt"=COALESCE(c."paidAt", pago."paidAt", NOW()),
    "paymentId"=CASE
                  WHEN c."paymentId" IS NOT NULL THEN c."paymentId"
                  WHEN EXISTS (SELECT 1 FROM "SubscriptionBillingCycle" c2
                               WHERE c2."paymentId"=pago.payment_id) THEN NULL
                  ELSE pago.payment_id END,
    "updatedAt"=NOW()
FROM pago
WHERE c."subscriptionId"=pago."subscriptionId" AND c."cycleNumber"=pago."cycleNumber"
  AND c.status IN ('PENDING','FAILED');

-- ── PASO 2: backlog ANTERIOR a junio 2026 -> PAID (sin exigir pago) ─────────
UPDATE "SubscriptionBillingCycle" c
SET status='PAID', "paidAt"=COALESCE(c."paidAt", c."dueAt"), "updatedAt"=NOW()
WHERE c.status IN ('PENDING','FAILED')
  AND c."periodStartAt" < DATE '2026-06-01';

-- ── PASO 3a: sin impago vencido más allá de la gracia -> ACTIVE (al día) ────
UPDATE "Subscription" s SET status='ACTIVE', "updatedAt"=NOW()
WHERE s.status='PAST_DUE'
  AND NOT EXISTS (SELECT 1 FROM "SubscriptionBillingCycle" c
    WHERE c."subscriptionId"=s.id AND c.status IN ('PENDING','FAILED')
      AND c."dueAt" < NOW() - (s."graceDays"*INTERVAL '1 day'));

-- ── PASO 3b: impago vencido más allá de la gracia -> PAST_DUE (en mora) ─────
UPDATE "Subscription" s SET status='PAST_DUE', "updatedAt"=NOW()
WHERE s.status='ACTIVE'
  AND EXISTS (SELECT 1 FROM "SubscriptionBillingCycle" c
    WHERE c."subscriptionId"=s.id AND c.status IN ('PENDING','FAILED')
      AND c."dueAt" < NOW() - (s."graceDays"*INTERVAL '1 day'));

-- Revisa las filas afectadas por cada UPDATE. Si todo cuadra:
--   COMMIT;
-- Si algo no cuadra:
--   ROLLBACK;
