-- Add enum value for jobs
ALTER TYPE "RetryJobType" ADD VALUE IF NOT EXISTS 'GAMIFICATION_RECALC';

-- CreateEnum
CREATE TYPE "GamificationEntityType" AS ENUM ('CUSTOMER', 'PRODUCT', 'PLAN', 'SUBSCRIPTION', 'JOB');

-- CreateTable
CREATE TABLE "GamificationEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "entityType" "GamificationEntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "statusDelta" INTEGER NOT NULL DEFAULT 0,
    "lifetimeDelta" INTEGER NOT NULL DEFAULT 0,
    "rewardDelta" INTEGER NOT NULL DEFAULT 0,
    "moneyInCents" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamificationScore" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "entityType" "GamificationEntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "statusScore" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "lastActivityAt" TIMESTAMP(3),
    "lastPaymentAt" TIMESTAMP(3),
    "lastDecayAt" TIMESTAMP(3),
    "streakMonths" INTEGER NOT NULL DEFAULT 0,
    "dataQualityScore" INTEGER NOT NULL DEFAULT 0,
    "recencyScore" INTEGER NOT NULL DEFAULT 0,
    "monetaryScore" INTEGER NOT NULL DEFAULT 0,
    "activityScore" INTEGER NOT NULL DEFAULT 0,
    "consistencyScore" INTEGER NOT NULL DEFAULT 0,
    "penaltyScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GamificationScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamificationRewardLedger" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "tenantId" UUID,
    "eventId" UUID,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "pointsRedeemed" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamificationRewardLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GamificationEvent_tenantId_createdAt_idx" ON "GamificationEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "GamificationEvent_entityType_entityId_createdAt_idx" ON "GamificationEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "GamificationEvent_kind_createdAt_idx" ON "GamificationEvent"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GamificationScore_tenantId_entityType_entityId_key" ON "GamificationScore"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "GamificationScore_tenantId_entityType_level_idx" ON "GamificationScore"("tenantId", "entityType", "level");

-- CreateIndex
CREATE INDEX "GamificationScore_entityType_statusScore_idx" ON "GamificationScore"("entityType", "statusScore");

-- CreateIndex
CREATE INDEX "GamificationRewardLedger_customerId_createdAt_idx" ON "GamificationRewardLedger"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "GamificationRewardLedger_tenantId_createdAt_idx" ON "GamificationRewardLedger"("tenantId", "createdAt");
