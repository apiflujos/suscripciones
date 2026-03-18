-- Add enums for campaigns
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT','RUNNING','PAUSED','COMPLETED','FAILED');
CREATE TYPE "CampaignSendStatus" AS ENUM ('PENDING','SENT','FAILED','SKIPPED');

-- Add retry job type for campaigns
ALTER TYPE "RetryJobType" ADD VALUE IF NOT EXISTS 'SEND_CAMPAIGN';

-- Smart lists
CREATE TABLE "SmartList" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "rules" JSONB NOT NULL,
  "chatwootLabel" TEXT NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

  CONSTRAINT "SmartList_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmartList_name_key" ON "SmartList"("name");
CREATE UNIQUE INDEX "SmartList_chatwootLabel_key" ON "SmartList"("chatwootLabel");
CREATE INDEX "SmartList_enabled_createdAt_idx" ON "SmartList"("enabled", "createdAt");

-- Campaigns
CREATE TABLE "Campaign" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "smartListId" UUID,
  "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "content" TEXT NOT NULL,
  "templateParams" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Campaign_status_createdAt_idx" ON "Campaign"("status", "createdAt");
CREATE INDEX "Campaign_smartListId_idx" ON "Campaign"("smartListId");

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_smartListId_fkey"
  FOREIGN KEY ("smartListId") REFERENCES "SmartList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Campaign sends
CREATE TABLE "CampaignSend" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "campaignId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "status" "CampaignSendStatus" NOT NULL DEFAULT 'PENDING',
  "sentAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

  CONSTRAINT "CampaignSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignSend_campaignId_customerId_key" ON "CampaignSend"("campaignId", "customerId");
CREATE INDEX "CampaignSend_status_createdAt_idx" ON "CampaignSend"("status", "createdAt");
CREATE INDEX "CampaignSend_customerId_idx" ON "CampaignSend"("customerId");

ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
