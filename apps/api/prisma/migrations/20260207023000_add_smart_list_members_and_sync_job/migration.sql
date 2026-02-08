-- Add retry job type for smart list sync
ALTER TYPE "RetryJobType" ADD VALUE IF NOT EXISTS 'SYNC_SMART_LISTS';

-- Smart list members
CREATE TABLE "SmartListMember" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "smartListId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

  CONSTRAINT "SmartListMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmartListMember_smartListId_customerId_key" ON "SmartListMember"("smartListId", "customerId");
CREATE INDEX "SmartListMember_active_updatedAt_idx" ON "SmartListMember"("active", "updatedAt");

ALTER TABLE "SmartListMember" ADD CONSTRAINT "SmartListMember_smartListId_fkey"
  FOREIGN KEY ("smartListId") REFERENCES "SmartList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmartListMember" ADD CONSTRAINT "SmartListMember_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
