ALTER TABLE "Payment" ADD COLUMN "wompiPaymentLinkId" TEXT;
CREATE UNIQUE INDEX "Payment_wompiPaymentLinkId_key" ON "Payment"("wompiPaymentLinkId");

