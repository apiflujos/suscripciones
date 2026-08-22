-- La referencia del pago se reescribe en cada reintento (_R57, _R58, _R59...),
-- así que un webhook del intento anterior ya no encuentra a qué pago pertenece
-- y termina como pago huérfano. Cada intento guarda ahora la suya.
-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN "reference" TEXT;

-- CreateIndex
CREATE INDEX "PaymentAttempt_reference_idx" ON "PaymentAttempt"("reference");
