-- ==========================================================================
-- SINCRONIZACIÓN CLUB MERCADO DE VINOS — CLUB ACTUALIZADO.xlsx
-- Fecha del archivo: 2026-07-20
-- Motor: PostgreSQL / Prisma (tablas PascalCase entre comillas)
--
-- OBJETIVO
--   Sincronizar las 27 membresías informadas en el archivo:
--     ALFA 14, OMEGA 7, DELTA 6.
--   Se actualizan clientes y suscripciones existentes y se crean los faltantes.
--   No se suspenden clientes ausentes del XLSX: el archivo puede ser incremental.
--
-- SEGURIDAD
--   1. Reemplaza __MDV_TENANT_ID__ si el tenant no se puede resolver solo.
--   2. Ejecuta primero PREVIEW con p_apply = false.
--   3. Revisa especialmente las filas con review_required = true.
--   4. Para aplicar, cambia p_apply a true y vuelve a ejecutar todo el archivo.
--   5. El script aborta si encuentra coincidencias ambiguas.
--
-- DECISIONES DE NEGOCIO CODIFICADAS
--   * Los valores del XLSX son pesos; la base usa centavos (x100).
--   * VALOR = precio base del plan; DOMICILIO = recargo por suscripción;
--     totalInCents = PAGOS del XLSX.
--   * "Link de pago" => MANUAL_LINK.
--   * "Débito automático" => AUTO_DEBIT, sin inventar token/fuente Wompi.
--   * Diana: el XLSX dice link actual e "inscribir para débito"; queda
--     MANUAL_LINK y se registra la solicitud pendiente en metadata.
--   * Luis Eduardo tiene dos membresías: OMEGA y DELTA.
--   * No se crean pagos ni se marcan ciclos PAID: el archivo no prueba pagos.
--   * Nuevas membresías arrancan 2026-07-01, cobran el día 20 anticipado.
-- ==========================================================================

BEGIN;

CREATE TEMP TABLE mdv_sync_config (
  tenant_id uuid NOT NULL,
  apply_changes boolean NOT NULL,
  source_file text NOT NULL,
  source_date date NOT NULL
) ON COMMIT DROP;

-- Resolución automática por los planes canónicos de MDV. Si falla, reemplaza
-- __MDV_TENANT_ID__ por el UUID correcto antes de ejecutar.
INSERT INTO mdv_sync_config
SELECT
  COALESCE(
    (
      SELECT sp."tenantId"
      FROM "SubscriptionPlan" sp
      WHERE sp.metadata->>'mdvCanonical' = 'true'
      GROUP BY sp."tenantId"
      HAVING COUNT(*) FILTER (WHERE upper(sp.metadata->>'mdvCategory') IN ('ALPHA','OMEGA','DELTA')) = 3
      LIMIT 1
    ),
    NULLIF('__MDV_TENANT_ID__', '__MDV_TENANT_ID__')::uuid
  ),
  false, -- PREVIEW. Cambiar a true únicamente después de revisar.
  'CLUB ACTUALIZADO.xlsx',
  DATE '2026-07-20';

DO $$
BEGIN
  IF (SELECT tenant_id IS NULL FROM mdv_sync_config) THEN
    RAISE EXCEPTION 'No se pudo resolver el tenant MDV. Reemplaza __MDV_TENANT_ID__.';
  END IF;
END $$;

CREATE TEMP TABLE mdv_source (
  source_row integer NOT NULL,
  category text NOT NULL CHECK (category IN ('ALPHA','OMEGA','DELTA')),
  member_name text NOT NULL,
  identification_raw text NOT NULL,
  identification_digits text NOT NULL,
  phone_raw text NOT NULL,
  phone_digits text NOT NULL,
  base_cop integer NOT NULL,
  shipping_cop integer NOT NULL,
  total_cop integer NOT NULL,
  collection_mode text NOT NULL CHECK (collection_mode IN ('MANUAL_LINK','AUTO_DEBIT')),
  source_note text NOT NULL,
  review_required boolean NOT NULL DEFAULT false,
  review_reason text,
  PRIMARY KEY (category, identification_digits)
) ON COMMIT DROP;

INSERT INTO mdv_source VALUES
  (3,  'ALPHA','Alejandro Celis Posada',             '8029795',       '8029795',    '3217603910','3217603910',360000,30000,390000,'MANUAL_LINK','Link de pago',false,NULL),
  (4,  'ALPHA','Estela Maria Quintero Vallejo',      '43612238',      '43612238',   '3005069022','3005069022',360000,0,    360000,'MANUAL_LINK','Link de pago',false,NULL),
  (5,  'ALPHA','Diana Patricia Vélez',               '43879393',      '43879393',   '3006080361','3006080361',360000,0,    360000,'MANUAL_LINK','Link de pago - inscribir para debito',true,'Conservar link por ahora; falta completar inscripción/tokenización para débito'),
  (6,  'ALPHA','Wilfer Giraldo',                     '901039479',     '901039479',  '3014020145','3014020145',360000,0,    360000,'MANUAL_LINK','Link de pago',false,NULL),
  (7,  'ALPHA','Juan Camilo Moná Bouhot',            '1037616382',    '1037616382', '3104515951','3104515951',360000,18000,378000,'MANUAL_LINK','Link de pago',false,NULL),
  (8,  'ALPHA','Paola Vargas',                       '43753521',      '43753521',   '3217657849','3217657849',360000,0,    360000,'MANUAL_LINK','Link de pago',false,NULL),
  (9,  'ALPHA','Ricardo Uribe & Liliana Ruiz',       '71755139',      '71755139',   '3207278037','3207278037',360000,0,    360000,'MANUAL_LINK','Link de pago',false,NULL),
  (10, 'ALPHA','Sarah Ramirez',                      '1037651335',    '1037651335', '321 8123241','3218123241',360000,20000,380000,'MANUAL_LINK','Link de pago',false,NULL),
  (11, 'ALPHA','Simón Ruíz Martínez',                '1037638584',    '1037638584', '3123943473','3123943473',360000,0,    360000,'MANUAL_LINK','Link de pago',false,NULL),
  (12, 'ALPHA','Stella Maria Villegas Restrepo',     '32534429',      '32534429',   '3116301129','3116301129',360000,0,    360000,'AUTO_DEBIT','Debito Automatico',false,NULL),
  (13, 'ALPHA','Valentín Vélez',                     '1017193140',    '1017193140', '3104362040','3104362040',360000,0,    360000,'MANUAL_LINK','Link de pago',false,NULL),
  (14, 'ALPHA','Laura Nieto',                        '1017229800',    '1017229800', '3148871759','3148871759',360000,20000,380000,'MANUAL_LINK','Link de pago',false,NULL),
  (15, 'ALPHA','Mauricio Gómez',                     '71576392',      '71576392',   '3127858728','3127858728',360000,0,    360000,'AUTO_DEBIT','Débito automático',true,'Identificación no estaba registrada en el backup; coincidencia esperada por teléfono y nombre'),
  (16, 'ALPHA','Daniela García',                     '901662879-5',   '9016628795', '3104306516','3104306516',360000,0,    360000,'MANUAL_LINK','Link de pago',true,'NIT normalizado con DV; confirmar si 901662879-5 es correcto'),

  (18, 'OMEGA','Carlos Manuel Uribe',                '811020107',     '811020107',  '312 8986797','3128986797',460000,0,    460000,'MANUAL_LINK','Link de pago',true,'El teléfono difiere del backup anterior (3104241664); se prioriza el XLSX'),
  (19, 'OMEGA','Federico Balthazar',                 '71673609',      '71673609',   '3113088929','3113088929',460000,20000,480000,'MANUAL_LINK','Link de pago',false,NULL),
  (20, 'OMEGA','Isabel Cristina Maya Ángel',         '43843431',      '43843431',   '313 7466301','3137466301',460000,0,    460000,'MANUAL_LINK','Link de pago',true,'El teléfono difiere del backup anterior (3116088420); se prioriza el XLSX'),
  (21, 'OMEGA','Kristin Bustos',                     '1037578107',    '1037578107', '3004941227','3004941227',460000,0,    460000,'MANUAL_LINK','Link de pago',false,NULL),
  (22, 'OMEGA','Luis Eduardo Gutiérrez',             '11347993',      '11347993',   '3164533861','3164533861',460000,0,    460000,'AUTO_DEBIT','Debito automatico (tiene 2 membresias - adicionar delta)',true,'Debe conservar OMEGA y además tener DELTA'),
  (23, 'OMEGA','Maria Elsa Echavarría',              '42963727',      '42963727',   '3146833333','3146833333',460000,20000,480000,'MANUAL_LINK','Link de pago',false,NULL),
  (24, 'OMEGA','Ricardo Espinal - Sotoluna',         '901035490',     '901035490',  '3206981623','3206981623',460000,0,    460000,'MANUAL_LINK','Link de pago',false,NULL),

  (26, 'DELTA','Ana Patricia Suarez',                '42878397',      '42878397',   '3102459530','3102459530',620000,0,    620000,'MANUAL_LINK','Link de pago',false,NULL),
  (27, 'DELTA','Gabriel Jaime Osorio',               '900087810',     '900087810',  '3156611037','3156611037',620000,0,    620000,'MANUAL_LINK','Link de pago',false,NULL),
  (28, 'DELTA','Luis Eduardo Gutiérrez',             '11347993',      '11347993',   '3164533861','3164533861',620000,30000,650000,'AUTO_DEBIT','Debito automatico',true,'Segunda membresía del mismo cliente; no fusionar con OMEGA'),
  (29, 'DELTA','Lina Marcela Cruz',                  '1144036039',    '1144036039', '3147791306','3147791306',620000,0,    620000,'MANUAL_LINK','Link de pago',false,NULL),
  (30, 'DELTA','Mauricio Agudelo',                   '98664632',      '98664632',   '3146166206','3146166206',620000,0,    620000,'AUTO_DEBIT','Debito automatico',false,NULL),
  (31, 'DELTA','Carolina Mendez Martinez',           '52719045',      '52719045',   '3112260340','3112260340',620000,30000,650000,'MANUAL_LINK','Link de pago',true,'No aparecía en el backup; probablemente se debe crear cliente y membresía');

DO $$
DECLARE
  n integer;
BEGIN
  SELECT COUNT(*) INTO n FROM mdv_source;
  IF n <> 27 THEN RAISE EXCEPTION 'Se esperaban 27 membresías; hay %', n; END IF;
  IF EXISTS (SELECT 1 FROM mdv_source WHERE total_cop <> base_cop + shipping_cop) THEN
    RAISE EXCEPTION 'Hay filas donde total != valor + domicilio';
  END IF;
END $$;

CREATE TEMP TABLE mdv_plan_map AS
SELECT src.category, src.plan_id
FROM (
  SELECT
    upper(sp.metadata->>'mdvCategory') AS category,
    sp.id AS plan_id,
    row_number() OVER (
      PARTITION BY upper(sp.metadata->>'mdvCategory')
      ORDER BY (sp.metadata->>'mdvCanonical' = 'true') DESC, sp."updatedAt" DESC, sp.id
    ) AS rn
  FROM "SubscriptionPlan" sp
  JOIN mdv_sync_config cfg ON cfg.tenant_id = sp."tenantId"
  WHERE upper(sp.metadata->>'mdvCategory') IN ('ALPHA','OMEGA','DELTA')
) src
WHERE src.rn = 1;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM mdv_plan_map) <> 3 THEN
    RAISE EXCEPTION 'No se encontraron exactamente los 3 planes canónicos MDV';
  END IF;
END $$;

CREATE TEMP TABLE mdv_customer_candidates AS
SELECT
  src.category,
  src.identification_digits,
  c.id AS customer_id,
  CASE
    WHEN regexp_replace(COALESCE(c.metadata->>'identificacionNumero', c.metadata->>'identificacion', c.metadata->>'documentNumber', ''), '\D', '', 'g') = src.identification_digits THEN 100
    WHEN regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = src.phone_digits THEN 80
    WHEN lower(trim(c.name)) = lower(trim(src.member_name)) THEN 60
    ELSE 0
  END AS match_score
FROM mdv_source src
JOIN mdv_sync_config cfg ON true
JOIN "Customer" c ON c."tenantId" = cfg.tenant_id
WHERE regexp_replace(COALESCE(c.metadata->>'identificacionNumero', c.metadata->>'identificacion', c.metadata->>'documentNumber', ''), '\D', '', 'g') = src.identification_digits
   OR regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = src.phone_digits
   OR lower(trim(c.name)) = lower(trim(src.member_name));

CREATE TEMP TABLE mdv_customer_match AS
SELECT category, identification_digits, customer_id, match_score
FROM (
  SELECT c.*,
         row_number() OVER (PARTITION BY category, identification_digits ORDER BY match_score DESC, customer_id) AS rn,
         count(*) FILTER (WHERE match_score = max_score) OVER (PARTITION BY category, identification_digits) AS top_ties
  FROM (
    SELECT c.*, max(match_score) OVER (PARTITION BY category, identification_digits) AS max_score
    FROM mdv_customer_candidates c
  ) c
) ranked
WHERE rn = 1;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM mdv_customer_match WHERE top_ties > 1) THEN
    RAISE EXCEPTION 'Coincidencia ambigua de clientes. Revisa mdv_customer_candidates.';
  END IF;
END $$;

-- PREVIEW principal. Siempre se devuelve, incluso en modo aplicación.
SELECT
  src.category,
  src.member_name,
  src.identification_raw,
  src.phone_raw,
  src.base_cop,
  src.shipping_cop,
  src.total_cop,
  src.collection_mode,
  CASE WHEN cm.customer_id IS NULL THEN 'CREATE_CUSTOMER' ELSE 'UPDATE_CUSTOMER' END AS customer_action,
  CASE WHEN EXISTS (
    SELECT 1 FROM "Subscription" s
    JOIN mdv_plan_map pm ON pm.plan_id = s."planId" AND pm.category = src.category
    WHERE s."customerId" = cm.customer_id
  ) THEN 'UPDATE_SUBSCRIPTION' ELSE 'CREATE_SUBSCRIPTION' END AS subscription_action,
  cm.customer_id,
  src.review_required,
  src.review_reason
FROM mdv_source src
LEFT JOIN mdv_customer_match cm USING (category, identification_digits)
ORDER BY CASE src.category WHEN 'ALPHA' THEN 1 WHEN 'OMEGA' THEN 2 ELSE 3 END, src.source_row;

-- Si estamos en PREVIEW, no se modifica nada y la transacción termina aquí.
DO $$
BEGIN
  IF NOT (SELECT apply_changes FROM mdv_sync_config) THEN
    RAISE NOTICE 'PREVIEW terminado: no se aplicaron cambios. Cambia apply_changes a true después de revisar.';
  END IF;
END $$;

-- A partir de aquí, cada escritura queda condicionada por apply_changes.
CREATE TEMP TABLE mdv_resolved_customer (
  category text NOT NULL,
  identification_digits text NOT NULL,
  customer_id uuid NOT NULL,
  PRIMARY KEY (category, identification_digits)
) ON COMMIT DROP;

INSERT INTO mdv_resolved_customer
SELECT category, identification_digits, customer_id
FROM mdv_customer_match;

CREATE TEMP TABLE mdv_new_customers (
  category text NOT NULL,
  identification_digits text NOT NULL,
  customer_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  member_name text NOT NULL,
  phone_digits text NOT NULL,
  identification_raw text NOT NULL,
  source_row integer NOT NULL,
  source_file text NOT NULL,
  PRIMARY KEY (category, identification_digits)
) ON COMMIT DROP;

INSERT INTO mdv_new_customers
SELECT
  src.category,
  src.identification_digits,
  gen_random_uuid(),
  cfg.tenant_id,
  src.member_name,
  src.phone_digits,
  src.identification_raw,
  src.source_row,
  cfg.source_file
FROM mdv_source src
CROSS JOIN mdv_sync_config cfg
LEFT JOIN mdv_customer_match cm USING (category, identification_digits)
WHERE cfg.apply_changes AND cm.customer_id IS NULL;

INSERT INTO "Customer" (id, "tenantId", name, email, phone, metadata, "createdAt", "updatedAt")
SELECT
  nc.customer_id, nc.tenant_id, nc.member_name, NULL, nc.phone_digits,
  jsonb_build_object(
    'identificacion', nc.identification_raw,
    'identificacionNumero', nc.identification_digits,
    'importSource', 'club-actualizado-2026-07-20',
    'mdv', jsonb_build_object('category', nc.category, 'sourceRow', nc.source_row, 'sourceFile', nc.source_file)
  ),
  NOW(), NOW()
FROM mdv_new_customers nc;

INSERT INTO mdv_resolved_customer
SELECT category, identification_digits, customer_id
FROM mdv_new_customers;

UPDATE "Customer" c
SET name = src.member_name,
    phone = src.phone_digits,
    metadata = COALESCE(c.metadata, '{}'::jsonb)
      || jsonb_build_object(
           'identificacion', src.identification_raw,
           'identificacionNumero', src.identification_digits,
           'importSource', 'club-actualizado-2026-07-20'
         )
      || jsonb_build_object(
           'mdv', COALESCE(c.metadata->'mdv', '{}'::jsonb)
             || jsonb_build_object(
                  'category', src.category,
                  'sourceRow', src.source_row,
                  'sourceFile', cfg.source_file,
                  'sourceDate', cfg.source_date,
                  'reviewRequired', src.review_required,
                  'reviewReason', src.review_reason
                )
         ),
    "updatedAt" = NOW()
FROM mdv_source src
JOIN mdv_resolved_customer rc USING (category, identification_digits)
CROSS JOIN mdv_sync_config cfg
WHERE cfg.apply_changes AND c.id = rc.customer_id;

-- Elegir una suscripción por cliente/categoría. Primero busca el plan canónico;
-- como fallback acepta cualquier plan MDV de la misma categoría para corregirlo
-- al plan canónico. Si hay varias, privilegia una no cancelada.
CREATE TEMP TABLE mdv_subscription_match AS
SELECT category, identification_digits, subscription_id
FROM (
  SELECT
    src.category,
    src.identification_digits,
    s.id AS subscription_id,
    row_number() OVER (
      PARTITION BY src.category, src.identification_digits
      ORDER BY
        (s.status IN ('ACTIVE','PAST_DUE')) DESC,
        (s."planId" = pm.plan_id) DESC,
        s."updatedAt" DESC,
        s.id
    ) AS rn
  FROM mdv_source src
  JOIN mdv_resolved_customer rc USING (category, identification_digits)
  JOIN mdv_plan_map pm USING (category)
  JOIN "Subscription" s ON s."customerId" = rc.customer_id
  JOIN "SubscriptionPlan" current_plan ON current_plan.id = s."planId"
  WHERE s."planId" = pm.plan_id
     OR upper(current_plan.metadata->>'mdvCategory') = src.category
     OR upper(COALESCE(s.metadata->>'planLabel', '')) LIKE '%' || src.category || '%'
) ranked
WHERE rn = 1;

UPDATE "Subscription" s
SET status = s.status,
    "tenantId" = cfg.tenant_id,
    "planId" = pm.plan_id,
    "startAt" = LEAST(s."startAt", TIMESTAMP '2026-07-01 00:00:00'),
    "cycleStartDay" = 1,
    "paymentDay" = 20,
    "paymentTiming" = 'ANTICIPADO',
    "graceDays" = GREATEST(s."graceDays", 1),
    "canceledAt" = CASE WHEN s.status IN ('ACTIVE','PAST_DUE') THEN NULL ELSE s."canceledAt" END,
    "suspendedAt" = CASE WHEN s.status IN ('ACTIVE','PAST_DUE') THEN NULL ELSE s."suspendedAt" END,
    metadata = COALESCE(s.metadata, '{}'::jsonb)
      || jsonb_build_object(
           'collectionMode', src.collection_mode,
           'planLabel', 'Suscripción ' || initcap(lower(src.category)),
           'requiresShipping', src.shipping_cop > 0,
           'billingPeriodMonths', 1,
           'importSource', 'club-actualizado-2026-07-20',
           'pricing', jsonb_build_object(
             'currency', 'COP',
             'basePriceInCents', src.base_cop * 100,
             'shippingInCents', src.shipping_cop * 100,
             'totalInCents', src.total_cop * 100
           ),
           'mdvSync', jsonb_build_object(
             'sourceFile', cfg.source_file,
             'sourceDate', cfg.source_date,
             'sourceRow', src.source_row,
             'sourceNote', src.source_note,
             'debitEnrollmentRequested', src.member_name = 'Diana Patricia Vélez',
             'reviewRequired', src.review_required,
             'reviewReason', src.review_reason
           )
         ),
    "updatedAt" = NOW()
FROM mdv_source src
JOIN mdv_subscription_match sm USING (category, identification_digits)
JOIN mdv_plan_map pm USING (category)
CROSS JOIN mdv_sync_config cfg
WHERE cfg.apply_changes
  AND s.id = sm.subscription_id
  AND s.status IN ('ACTIVE','PAST_DUE');

WITH created AS (
  INSERT INTO "Subscription" (
    id, "tenantId", "customerId", "planId", status, "startAt",
    "cycleStartDay", "paymentDay", "paymentTiming", "graceDays",
    "retryCount", "maxRetries", metadata, "createdAt", "updatedAt"
  )
  SELECT
    gen_random_uuid(), cfg.tenant_id, rc.customer_id, pm.plan_id, 'ACTIVE',
    TIMESTAMP '2026-07-01 00:00:00', 1, 20, 'ANTICIPADO', 1, 0, 3,
    jsonb_build_object(
      'collectionMode', src.collection_mode,
      'planLabel', 'Suscripción ' || initcap(lower(src.category)),
      'requiresShipping', src.shipping_cop > 0,
      'billingPeriodMonths', 1,
      'importSource', 'club-actualizado-2026-07-20',
      'pricing', jsonb_build_object(
        'currency', 'COP',
        'basePriceInCents', src.base_cop * 100,
        'shippingInCents', src.shipping_cop * 100,
        'totalInCents', src.total_cop * 100
      ),
      'mdvSync', jsonb_build_object(
        'sourceFile', cfg.source_file,
        'sourceDate', cfg.source_date,
        'sourceRow', src.source_row,
        'sourceNote', src.source_note,
        'debitEnrollmentRequested', src.member_name = 'Diana Patricia Vélez',
        'reviewRequired', src.review_required,
        'reviewReason', src.review_reason
      )
    ),
    NOW(), NOW()
  FROM mdv_source src
  JOIN mdv_resolved_customer rc USING (category, identification_digits)
  JOIN mdv_plan_map pm USING (category)
  CROSS JOIN mdv_sync_config cfg
  LEFT JOIN mdv_subscription_match sm USING (category, identification_digits)
  WHERE cfg.apply_changes
    AND (
      sm.subscription_id IS NULL
      OR EXISTS (
        SELECT 1 FROM "Subscription" matched
        WHERE matched.id = sm.subscription_id
          AND matched.status NOT IN ('ACTIVE','PAST_DUE')
      )
    )
  RETURNING id
)
SELECT COUNT(*) AS subscriptions_created FROM created;

-- Suspender duplicados adicionales del mismo cliente/categoría.
UPDATE "Subscription" s
SET status = 'SUSPENDED',
    "suspendedAt" = COALESCE(s."suspendedAt", NOW()),
    metadata = COALESCE(s.metadata, '{}'::jsonb)
      || jsonb_build_object('mdvSyncDuplicate', true, 'mdvSyncDuplicateAt', NOW()),
    "updatedAt" = NOW()
FROM mdv_source src
JOIN mdv_resolved_customer rc USING (category, identification_digits)
JOIN mdv_plan_map pm USING (category)
JOIN mdv_subscription_match sm USING (category, identification_digits)
CROSS JOIN mdv_sync_config cfg
WHERE cfg.apply_changes
  AND s."customerId" = rc.customer_id
  AND s."planId" = pm.plan_id
  AND s.id <> sm.subscription_id
  AND s.status IN ('ACTIVE','PAST_DUE');

-- Verificación final: en APPLY las 27 filas fuente deben resolver a una
-- membresía vigente única. Pueden existir membresías históricas en otros planes.
DO $$
DECLARE
  resolved_count integer;
  duplicate_count integer;
BEGIN
  IF (SELECT apply_changes FROM mdv_sync_config) THEN
    SELECT COUNT(*) INTO resolved_count
    FROM mdv_source src
    JOIN mdv_resolved_customer rc USING (category, identification_digits)
    JOIN mdv_plan_map pm USING (category)
    JOIN "Subscription" s
      ON s."customerId" = rc.customer_id
     AND s."planId" = pm.plan_id
     AND s.status IN ('ACTIVE','PAST_DUE');

    SELECT COUNT(*) INTO duplicate_count
    FROM (
      SELECT src.category, src.identification_digits
      FROM mdv_source src
      JOIN mdv_resolved_customer rc USING (category, identification_digits)
      JOIN mdv_plan_map pm USING (category)
      JOIN "Subscription" s
        ON s."customerId" = rc.customer_id
       AND s."planId" = pm.plan_id
       AND s.status IN ('ACTIVE','PAST_DUE')
      GROUP BY src.category, src.identification_digits
      HAVING COUNT(*) <> 1
    ) duplicates;

    IF resolved_count <> 27 OR duplicate_count <> 0 THEN
      RAISE EXCEPTION 'Validación final falló: filas resueltas %, grupos duplicados %', resolved_count, duplicate_count;
    END IF;
  END IF;
END $$;

SELECT
  src.category,
  src.member_name,
  src.identification_raw,
  src.phone_raw,
  src.collection_mode,
  src.total_cop,
  c.id AS customer_id,
  s.id AS subscription_id,
  s.status,
  s.metadata->'pricing' AS pricing,
  src.review_required,
  src.review_reason
FROM mdv_source src
LEFT JOIN mdv_resolved_customer rc USING (category, identification_digits)
LEFT JOIN "Customer" c ON c.id = rc.customer_id
LEFT JOIN mdv_plan_map pm USING (category)
LEFT JOIN "Subscription" s
  ON s."customerId" = rc.customer_id
 AND s."planId" = pm.plan_id
 AND s.status IN ('ACTIVE','PAST_DUE')
ORDER BY CASE src.category WHEN 'ALPHA' THEN 1 WHEN 'OMEGA' THEN 2 ELSE 3 END, src.source_row;

-- En PREVIEW se revierte de forma explícita; en APPLY se confirma.
DO $$
BEGIN
  IF NOT (SELECT apply_changes FROM mdv_sync_config) THEN
    RAISE NOTICE 'ROLLBACK lógico: el modo PREVIEW no ejecutó escrituras.';
  END IF;
END $$;

COMMIT;
