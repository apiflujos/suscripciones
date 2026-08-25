-- Un ciclo marcado como PAID debe tener un pago asociado.
-- Esto previene que se marquen ciclos como cobrados sin evidencia de cobro.
--
-- La tabla se llama "SubscriptionBillingCycle" (no "BillingCycle"): el modelo de
-- Prisma es SubscriptionBillingCycle y no hay @@map que lo renombre.
--
-- Se añade NOT VALID a propósito. En producción hay 74 ciclos históricos en PAID
-- sin paymentId (feb–may 2026) y qué hacer con ellos es una decisión de negocio
-- todavía abierta. Con NOT VALID el constraint rige para todo lo que se escriba
-- de aquí en adelante —que es lo que hay que impedir— sin tocar esas filas y sin
-- abortar el deploy. Postgres tampoco toma un lock largo de tabla.
--
-- Una vez saneadas esas filas (npm run repair:paid-cycles), validar el histórico:
--   ALTER TABLE "SubscriptionBillingCycle"
--     VALIDATE CONSTRAINT "SubscriptionBillingCycle_paid_requires_payment";
ALTER TABLE "SubscriptionBillingCycle"
  ADD CONSTRAINT "SubscriptionBillingCycle_paid_requires_payment"
  CHECK ("status" != 'PAID' OR "paymentId" IS NOT NULL)
  NOT VALID;
