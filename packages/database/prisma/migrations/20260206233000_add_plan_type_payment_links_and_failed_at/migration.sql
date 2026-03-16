-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('manual_link', 'auto_subscription');

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN "planType" "PlanType" NOT NULL DEFAULT 'manual_link';

-- Backfill planType from legacy metadata.collectionMode
UPDATE "SubscriptionPlan"
SET "planType" = 'auto_subscription'
WHERE ("metadata"->>'collectionMode') IN ('AUTO_LINK', 'AUTO_DEBIT');

UPDATE "SubscriptionPlan"
SET "planType" = 'manual_link'
WHERE ("metadata"->>'collectionMode') IN ('MANUAL_LINK');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "failedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "wompiPaymentLinkId" TEXT NOT NULL,
    "checkoutUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_paymentId_key" ON "PaymentLink"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_wompiPaymentLinkId_key" ON "PaymentLink"("wompiPaymentLinkId");

-- CreateIndex
CREATE INDEX "PaymentLink_planId_sentAt_idx" ON "PaymentLink"("planId", "sentAt");

-- CreateIndex
CREATE INDEX "PaymentLink_subscriptionId_sentAt_idx" ON "PaymentLink"("subscriptionId", "sentAt");

-- CreateIndex
CREATE INDEX "PaymentLink_sentAt_idx" ON "PaymentLink"("sentAt");

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill PaymentLink rows from existing Payment records (where a Wompi payment link exists).
INSERT INTO "PaymentLink" (
  "id",
  "planId",
  "subscriptionId",
  "paymentId",
  "wompiPaymentLinkId",
  "checkoutUrl",
  "status",
  "sentAt",
  "paidAt",
  "createdAt",
  "updatedAt"
)
SELECT
  p."id" AS "id",
  s."planId" AS "planId",
  p."subscriptionId" AS "subscriptionId",
  p."id" AS "paymentId",
  p."wompiPaymentLinkId" AS "wompiPaymentLinkId",
  p."checkoutUrl" AS "checkoutUrl",
  CASE WHEN p."status" = 'APPROVED' THEN 'PAID' ELSE 'SENT' END AS "status",
  COALESCE(
    (
      SELECT MIN(pa."createdAt")
      FROM "PaymentAttempt" pa
      WHERE pa."paymentId" = p."id" AND pa."status" = 'PAYMENT_LINK_CREATED'
    ),
    p."updatedAt",
    p."createdAt"
  ) AS "sentAt",
  p."paidAt" AS "paidAt",
  COALESCE(p."createdAt", CURRENT_TIMESTAMP) AS "createdAt",
  p."updatedAt" AS "updatedAt"
FROM "Payment" p
JOIN "Subscription" s ON s."id" = p."subscriptionId"
WHERE p."subscriptionId" IS NOT NULL
  AND p."wompiPaymentLinkId" IS NOT NULL
  AND p."checkoutUrl" IS NOT NULL
ON CONFLICT ("wompiPaymentLinkId") DO NOTHING;

