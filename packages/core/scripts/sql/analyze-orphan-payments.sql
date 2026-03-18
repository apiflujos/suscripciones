-- Análisis de Pagos sin Suscripción (Huérfanos)
-- Ejecutar en psql o herramienta SQL

-- 1. Total de pagos sin suscripción
SELECT 
  COUNT(*) as total_pagos_huerfanos,
  COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pendientes,
  COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as aprobados,
  COUNT(CASE WHEN status = 'DECLINED' THEN 1 END) as declinados,
  COUNT(CASE WHEN status = 'ERROR' THEN 1 END) as error,
  COUNT(CASE WHEN "wompiTransactionId" IS NOT NULL THEN 1 END) as con_transaccion_wompi,
  COUNT(CASE WHEN "wompiPaymentLinkId" IS NOT NULL THEN 1 END) as con_link_pago
FROM "Payment"
WHERE "subscriptionId" IS NULL;

-- 2. Pagos huérfanos por antigüedad
SELECT 
  CASE 
    WHEN "createdAt" > NOW() - INTERVAL '7 days' THEN 'Menos de 7 días'
    WHEN "createdAt" > NOW() - INTERVAL '30 days' THEN '7-30 días'
    WHEN "createdAt" > NOW() - INTERVAL '90 days' THEN '30-90 días'
    ELSE 'Más de 90 días'
  END as antiguedad,
  COUNT(*) as cantidad,
  SUM("amountInCents") as total_monto_cents
FROM "Payment"
WHERE "subscriptionId" IS NULL
GROUP BY 1
ORDER BY 1;

-- 3. Clientes con pagos huérfanos (para ver si tienen suscripciones)
SELECT 
  c.id as customer_id,
  c.email,
  c.name,
  COUNT(p.id) as pagos_huerfanos,
  COUNT(s.id) as suscripciones_activas,
  MAX(p."createdAt") as ultimo_pago_huerfano
FROM "Customer" c
LEFT JOIN "Payment" p ON p."customerId" = c.id AND p."subscriptionId" IS NULL
LEFT JOIN "Subscription" s ON s."customerId" = c.id
GROUP BY c.id, c.email, c.name
HAVING COUNT(p.id) > 0
ORDER BY pagos_huerfanos DESC
LIMIT 20;

-- 4. Pagos huérfanos que SÍ tienen transacción de Wompi (posible match manual)
SELECT 
  p.id,
  p."customerId",
  p."amountInCents",
  p."wompiTransactionId",
  p."wompiPaymentLinkId",
  p."reference",
  p.status,
  p."createdAt",
  c.email,
  c.name
FROM "Payment" p
LEFT JOIN "Customer" c ON c.id = p."customerId"
WHERE p."subscriptionId" IS NULL
  AND p."wompiTransactionId" IS NOT NULL
ORDER BY p."createdAt" DESC
LIMIT 50;

-- 5. Posibles matches por email + monto (para asignar manualmente)
SELECT 
  p.id as payment_id,
  p."customerId",
  p."amountInCents",
  p."reference",
  p."createdAt" as pago_created,
  s.id as subscription_id,
  s."customerId" as sub_customer_id,
  s.status as sub_status,
  s."currentPeriodEndAt",
  'MATCH_POTENCIAL' as sugerencia
FROM "Payment" p
CROSS JOIN "Subscription" s
WHERE p."subscriptionId" IS NULL
  AND p."customerId" != s."customerId"  -- Diferente cliente (posible error de asignación)
  AND p."amountInCents" = (
    SELECT price 
    FROM "SubscriptionPlan" sp 
    WHERE sp.id = s."planId"
  )
  AND ABS(EXTRACT(EPOCH FROM (p."createdAt" - s."currentPeriodEndAt")) / 3600) < 24  -- Dentro de 24h del corte
  AND p.status = 'APPROVED'
ORDER BY p."createdAt" DESC
LIMIT 20;

-- 6. Pagos huérfanos por eliminar (pendientes/declinados antiguos sin transacción)
SELECT 
  p.id,
  p."customerId",
  p."amountInCents",
  p.status,
  p."createdAt",
  c.email,
  'ELIMINAR_CANDIDATO' as accion
FROM "Payment" p
LEFT JOIN "Customer" c ON c.id = p."customerId"
WHERE p."subscriptionId" IS NULL
  AND p.status IN ('PENDING', 'DECLINED', 'ERROR')
  AND p."wompiTransactionId" IS NULL
  AND p."createdAt" < NOW() - INTERVAL '30 days'
ORDER BY p."createdAt" ASC
LIMIT 100;

-- 7. Estadísticas de limpieza recomendada
SELECT 
  'TOTAL_PAGOS_HUERFANOS' as categoria,
  COUNT(*) as cantidad
FROM "Payment" WHERE "subscriptionId" IS NULL

UNION ALL

SELECT 
  'ELIMINABLES_INMEDIATAS' as categoria,
  COUNT(*) as cantidad
FROM "Payment" p
WHERE p."subscriptionId" IS NULL
  AND p.status IN ('PENDING', 'DECLINED', 'ERROR')
  AND p."wompiTransactionId" IS NULL
  AND p."createdAt" < NOW() - INTERVAL '30 days'

UNION ALL

SELECT 
  'REVISAR_MANUALMENTE' as categoria,
  COUNT(*) as cantidad
FROM "Payment" p
WHERE p."subscriptionId" IS NULL
  AND p."wompiTransactionId" IS NOT NULL
  AND p.status = 'APPROVED'

UNION ALL

SELECT 
  'CONSERVAR' as categoria,
  COUNT(*) as cantidad
FROM "Payment" p
WHERE p."subscriptionId" IS NULL
  AND (
    p.status = 'APPROVED' 
    OR EXISTS (
      SELECT 1 FROM "Customer" c 
      WHERE c.id = p."customerId" 
      AND EXISTS (
        SELECT 1 FROM "Subscription" s 
        WHERE s."customerId" = c.id 
        AND s.status IN ('ACTIVE', 'PAST_DUE')
      )
    )
  );
