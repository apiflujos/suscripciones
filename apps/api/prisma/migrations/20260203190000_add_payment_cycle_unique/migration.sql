-- Add unique constraint for subscription payments per billing cycle
CREATE UNIQUE INDEX "Payment_subscriptionId_cycleNumber_key" ON "Payment"("subscriptionId", "cycleNumber");

