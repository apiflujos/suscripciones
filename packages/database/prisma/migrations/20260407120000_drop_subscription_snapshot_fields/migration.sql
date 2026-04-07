DROP INDEX IF EXISTS "Subscription_status_currentPeriodEndAt_idx";

ALTER TABLE "Subscription"
  DROP COLUMN IF EXISTS "currentCycle",
  DROP COLUMN IF EXISTS "currentPeriodStartAt",
  DROP COLUMN IF EXISTS "currentPeriodEndAt";

CREATE INDEX IF NOT EXISTS "Subscription_status_idx" ON "Subscription"("status");
