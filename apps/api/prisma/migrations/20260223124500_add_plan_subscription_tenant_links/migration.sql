-- Join tables for multi-tenant plans/subscriptions and user assignments
CREATE TABLE IF NOT EXISTS "SubscriptionPlanTenant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "planId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionPlanTenant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubscriptionPlanTenant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubscriptionPlanTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPlanTenant_planId_tenantId_key" ON "SubscriptionPlanTenant"("planId","tenantId");
CREATE INDEX IF NOT EXISTS "SubscriptionPlanTenant_tenantId_idx" ON "SubscriptionPlanTenant"("tenantId");

CREATE TABLE IF NOT EXISTS "SubscriptionTenant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subscriptionId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionTenant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubscriptionTenant_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubscriptionTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionTenant_subscriptionId_tenantId_key" ON "SubscriptionTenant"("subscriptionId","tenantId");
CREATE INDEX IF NOT EXISTS "SubscriptionTenant_tenantId_idx" ON "SubscriptionTenant"("tenantId");

CREATE TABLE IF NOT EXISTS "SaUserTenant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaUserTenant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SaUserTenant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SaUserTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SaUserTenant_userId_tenantId_key" ON "SaUserTenant"("userId","tenantId");
CREATE INDEX IF NOT EXISTS "SaUserTenant_tenantId_idx" ON "SaUserTenant"("tenantId");

-- Backfill existing tenantId values into join tables
INSERT INTO "SubscriptionPlanTenant" ("planId","tenantId")
SELECT "id","tenantId" FROM "SubscriptionPlan" WHERE "tenantId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "SubscriptionTenant" ("subscriptionId","tenantId")
SELECT "id","tenantId" FROM "Subscription" WHERE "tenantId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "SaUserTenant" ("userId","tenantId")
SELECT "id","tenantId" FROM "SaUser" WHERE "tenantId" IS NOT NULL
ON CONFLICT DO NOTHING;
