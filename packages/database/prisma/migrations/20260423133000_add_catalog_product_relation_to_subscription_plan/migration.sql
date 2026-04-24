ALTER TABLE "SubscriptionPlan"
ADD COLUMN "catalogProductId" UUID;

UPDATE "SubscriptionPlan" sp
SET "catalogProductId" = NULLIF(sp."metadata"->'catalog'->>'itemId', '')::uuid
WHERE COALESCE(sp."metadata"->>'kind', '') <> 'CATALOG_ITEM'
  AND NULLIF(sp."metadata"->'catalog'->>'itemId', '') IS NOT NULL
  AND (sp."metadata"->'catalog'->>'itemId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

CREATE INDEX "SubscriptionPlan_catalogProductId_idx" ON "SubscriptionPlan"("catalogProductId");

ALTER TABLE "SubscriptionPlan"
ADD CONSTRAINT "SubscriptionPlan_catalogProductId_fkey"
FOREIGN KEY ("catalogProductId") REFERENCES "SubscriptionPlan"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
