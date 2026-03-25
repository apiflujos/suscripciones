-- CreateEnum
CREATE TYPE "BillingCycleStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "SubscriptionBillingCycle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscriptionId" UUID NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "periodStartAt" TIMESTAMP(3) NOT NULL,
    "periodEndAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "BillingCycleStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paymentId" UUID,
    "paidOnTime" BOOLEAN,
    "daysEarly" INTEGER,
    "daysLate" INTEGER,
    "origin" "PaymentOrigin",
    "associationReason" "PaymentAssociationReason",
    "associatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionBillingCycle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionBillingCycle_subscriptionId_cycleNumber_key" ON "SubscriptionBillingCycle"("subscriptionId", "cycleNumber");

-- CreateIndex
CREATE INDEX "SubscriptionBillingCycle_subscriptionId_periodStartAt_idx" ON "SubscriptionBillingCycle"("subscriptionId", "periodStartAt");

-- CreateIndex
CREATE INDEX "SubscriptionBillingCycle_subscriptionId_paymentId_idx" ON "SubscriptionBillingCycle"("subscriptionId", "paymentId");

-- AddForeignKey
ALTER TABLE "SubscriptionBillingCycle" ADD CONSTRAINT "SubscriptionBillingCycle_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionBillingCycle" ADD CONSTRAINT "SubscriptionBillingCycle_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
