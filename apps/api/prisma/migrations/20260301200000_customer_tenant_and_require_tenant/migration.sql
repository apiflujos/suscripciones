-- CustomerTenant mapping
CREATE TABLE IF NOT EXISTS "CustomerTenant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerTenant_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  CREATE UNIQUE INDEX "CustomerTenant_customerId_tenantId_key" ON "CustomerTenant"("customerId","tenantId");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX "CustomerTenant_tenantId_idx" ON "CustomerTenant"("tenantId");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "CustomerTenant" ADD CONSTRAINT "CustomerTenant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerTenant" ADD CONSTRAINT "CustomerTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Resolve default tenant (apiflujos)
DO $$ 
DECLARE 
  tid UUID;
BEGIN
  SELECT "id" INTO tid FROM "SaTenant" WHERE lower("name") = lower('apiflujos') LIMIT 1;
  IF tid IS NULL THEN
    SELECT "id" INTO tid FROM "SaTenant" ORDER BY "createdAt" ASC LIMIT 1;
  END IF;
  IF tid IS NULL THEN
    INSERT INTO "SaTenant" ("id","name","active","createdAt","updatedAt")
    VALUES (gen_random_uuid(), 'apiflujos', true, now(), now())
    RETURNING "id" INTO tid;
  END IF;

  -- Backfill required tenant columns
  UPDATE "PublicCheckoutTemplate" SET "tenantId" = tid WHERE "tenantId" IS NULL;

  UPDATE "Subscription" s
  SET "tenantId" = COALESCE(s."tenantId", sp."tenantId", c."tenantId", tid)
  FROM "SubscriptionPlan" sp, "Customer" c
  WHERE s."tenantId" IS NULL AND s."planId" = sp."id" AND s."customerId" = c."id";

  UPDATE "Payment" p
  SET "tenantId" = COALESCE(p."tenantId", s."tenantId", c."tenantId", tid)
  FROM "Subscription" s, "Customer" c
  WHERE p."tenantId" IS NULL AND p."customerId" = c."id" AND (p."subscriptionId" = s."id" OR p."subscriptionId" IS NULL);

  UPDATE "PaymentLink" pl
  SET "tenantId" = COALESCE(pl."tenantId", p."tenantId", s."tenantId", sp."tenantId", tid)
  FROM "Payment" p, "Subscription" s, "SubscriptionPlan" sp
  WHERE pl."tenantId" IS NULL AND pl."paymentId" = p."id" AND pl."subscriptionId" = s."id" AND pl."planId" = sp."id";

  UPDATE "WebhookEvent" SET "tenantId" = tid WHERE "tenantId" IS NULL;

  UPDATE "ChatwootMessage" m
  SET "tenantId" = COALESCE(m."tenantId", p."tenantId", s."tenantId", c."tenantId", tid)
  FROM "Customer" c
  LEFT JOIN "Payment" p ON p."id" = m."paymentId"
  LEFT JOIN "Subscription" s ON s."id" = m."subscriptionId"
  WHERE m."tenantId" IS NULL AND m."customerId" = c."id";

  UPDATE "ReportCache" SET "tenantId" = tid WHERE "tenantId" IS NULL;
  UPDATE "SmartList" SET "tenantId" = tid WHERE "tenantId" IS NULL;
  UPDATE "Campaign" SET "tenantId" = tid WHERE "tenantId" IS NULL;
  UPDATE "CampaignSend" SET "tenantId" = tid WHERE "tenantId" IS NULL;

  -- Backfill customer-tenant links for primary tenantId
  INSERT INTO "CustomerTenant" ("customerId","tenantId")
  SELECT c."id", c."tenantId" FROM "Customer" c
  WHERE c."tenantId" IS NOT NULL
  ON CONFLICT DO NOTHING;
END $$;

ALTER TABLE "PublicCheckoutTemplate" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Subscription" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "PaymentLink" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "WebhookEvent" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ChatwootMessage" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ReportCache" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "SmartList" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Campaign" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "CampaignSend" ALTER COLUMN "tenantId" SET NOT NULL;
