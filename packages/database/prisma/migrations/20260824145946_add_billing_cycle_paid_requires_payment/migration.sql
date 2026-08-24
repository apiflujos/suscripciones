-- Un ciclo marcado como PAID debe tener un pago asociado.
-- Esto previene que se marquen ciclos como cobrados sin evidencia de cobro.
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_paid_requires_payment"
  CHECK ("status" != 'PAID' OR "paymentId" IS NOT NULL);
