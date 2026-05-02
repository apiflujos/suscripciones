-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- CreateIndex
CREATE INDEX "Payment_createdAt_status_idx" ON "Payment"("createdAt", "status");

-- CreateIndex
CREATE INDEX "SubscriptionBillingCycle_subscriptionId_status_idx" ON "SubscriptionBillingCycle"("subscriptionId", "status");

-- CreateIndex
CREATE INDEX "SubscriptionBillingCycle_dueAt_status_idx" ON "SubscriptionBillingCycle"("dueAt", "status");

-- CreateIndex
CREATE INDEX "SubscriptionBillingCycle_status_periodStartAt_idx" ON "SubscriptionBillingCycle"("status", "periodStartAt");

