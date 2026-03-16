-- Add a Prisma-friendly idempotency key for subscription payments per cycle
ALTER TABLE "Payment" ADD COLUMN "subscriptionCycleKey" TEXT;
CREATE UNIQUE INDEX "Payment_subscriptionCycleKey_key" ON "Payment"("subscriptionCycleKey");

-- Drop previous (non-Prisma-usable) unique index
DROP INDEX "Payment_subscriptionId_cycleNumber_key";

