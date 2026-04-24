ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "productId" UUID;

ALTER TABLE "PaymentLink"
  ADD COLUMN IF NOT EXISTS "productId" UUID;

UPDATE "Subscription" s
SET "productId" = sp_catalog."id"
FROM "SubscriptionPlan" sp_plan
JOIN "SubscriptionPlan" sp_catalog
  ON sp_catalog."id"::text = sp_plan."metadata"->'catalog'->>'itemId'
WHERE s."planId" = sp_plan."id"
  AND s."productId" IS NULL
  AND COALESCE(sp_catalog."metadata"->>'kind', '') = 'CATALOG_ITEM';

UPDATE "PaymentLink" pl
SET "productId" = COALESCE(s."productId", sp_catalog."id")
FROM "Subscription" s
LEFT JOIN "SubscriptionPlan" sp_plan
  ON sp_plan."id" = s."planId"
LEFT JOIN "SubscriptionPlan" sp_catalog
  ON sp_catalog."id"::text = sp_plan."metadata"->'catalog'->>'itemId'
WHERE pl."subscriptionId" = s."id"
  AND pl."productId" IS NULL
  AND (
    s."productId" IS NOT NULL
    OR COALESCE(sp_catalog."metadata"->>'kind', '') = 'CATALOG_ITEM'
  );

CREATE INDEX IF NOT EXISTS "Subscription_productId_idx" ON "Subscription"("productId");
CREATE INDEX IF NOT EXISTS "PaymentLink_productId_sentAt_idx" ON "PaymentLink"("productId", "sentAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Subscription_productId_fkey'
  ) THEN
    ALTER TABLE "Subscription"
      ADD CONSTRAINT "Subscription_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "SubscriptionPlan"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PaymentLink_productId_fkey'
  ) THEN
    ALTER TABLE "PaymentLink"
      ADD CONSTRAINT "PaymentLink_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "SubscriptionPlan"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
