-- Add tenantId columns (nullable) for multi-tenant support
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "PublicCheckoutTemplate" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "PaymentLink" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "ChatwootMessage" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "SmartList" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "CampaignSend" ADD COLUMN IF NOT EXISTS "tenantId" UUID;

-- Foreign keys
ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionPlan"
  ADD CONSTRAINT "SubscriptionPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PublicCheckoutTemplate"
  ADD CONSTRAINT "PublicCheckoutTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentLink"
  ADD CONSTRAINT "PaymentLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent"
  ADD CONSTRAINT "WebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatwootMessage"
  ADD CONSTRAINT "ChatwootMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmartList"
  ADD CONSTRAINT "SmartList_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignSend"
  ADD CONSTRAINT "CampaignSend_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS "Customer_tenantId_idx" ON "Customer"("tenantId");
CREATE INDEX IF NOT EXISTS "SubscriptionPlan_tenantId_idx" ON "SubscriptionPlan"("tenantId");
CREATE INDEX IF NOT EXISTS "PublicCheckoutTemplate_tenantId_idx" ON "PublicCheckoutTemplate"("tenantId");
CREATE INDEX IF NOT EXISTS "Subscription_tenantId_idx" ON "Subscription"("tenantId");
CREATE INDEX IF NOT EXISTS "Payment_tenantId_idx" ON "Payment"("tenantId");
CREATE INDEX IF NOT EXISTS "PaymentLink_tenantId_idx" ON "PaymentLink"("tenantId");
CREATE INDEX IF NOT EXISTS "WebhookEvent_tenantId_idx" ON "WebhookEvent"("tenantId");
CREATE INDEX IF NOT EXISTS "ChatwootMessage_tenantId_idx" ON "ChatwootMessage"("tenantId");
CREATE INDEX IF NOT EXISTS "SmartList_tenantId_idx" ON "SmartList"("tenantId");
CREATE INDEX IF NOT EXISTS "Campaign_tenantId_idx" ON "Campaign"("tenantId");
CREATE INDEX IF NOT EXISTS "CampaignSend_tenantId_idx" ON "CampaignSend"("tenantId");
