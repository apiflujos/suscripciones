-- Add enum value to existing RetryJobType
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'RetryJobType' AND e.enumlabel = 'BILLING_MONTHLY_REPORT'
  ) THEN
    ALTER TYPE "RetryJobType" ADD VALUE 'BILLING_MONTHLY_REPORT';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "SaUserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'AGENT');

-- CreateEnum
CREATE TYPE "SaPeriodType" AS ENUM ('monthly', 'total');

-- CreateEnum
CREATE TYPE "SaPlanKind" AS ENUM ('MASTER', 'PRO', 'ON_DEMAND');

-- CreateTable
CREATE TABLE "SaTenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaTenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaUser" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "SaUserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaSession" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "SaSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaModuleDefinition" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaModuleDefinition_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SaTenantModuleToggle" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaTenantModuleToggle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaLimitDefinition" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodType" "SaPeriodType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaLimitDefinition_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SaPlanDefinition" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SaPlanKind" NOT NULL,
    "monthlyPriceInCents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaPlanDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaPlanServiceLimit" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "isUnlimited" BOOLEAN NOT NULL DEFAULT false,
    "maxValue" INTEGER,
    "unitPriceInCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaPlanServiceLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaTenantPlanSnapshot" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "snapshot" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaTenantPlanSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaUsageEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "periodType" "SaPeriodType" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "source" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaUsageCounter" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaUsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaBillingEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceInCents" INTEGER NOT NULL,
    "totalInCents" INTEGER NOT NULL,
    "periodType" "SaPeriodType" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaBillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaBillingCounter" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "totalQuantity" INTEGER NOT NULL DEFAULT 0,
    "totalInCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaBillingCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaUser_email_key" ON "SaUser"("email");

-- CreateIndex
CREATE INDEX "SaUser_tenantId_idx" ON "SaUser"("tenantId");

-- CreateIndex
CREATE INDEX "SaUser_role_idx" ON "SaUser"("role");

-- CreateIndex
CREATE UNIQUE INDEX "SaSession_tokenHash_key" ON "SaSession"("tokenHash");

-- CreateIndex
CREATE INDEX "SaSession_email_expiresAt_idx" ON "SaSession"("email", "expiresAt");

-- CreateIndex
CREATE INDEX "SaSession_expiresAt_idx" ON "SaSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaTenantModuleToggle_tenantId_moduleKey_key" ON "SaTenantModuleToggle"("tenantId", "moduleKey");

-- CreateIndex
CREATE INDEX "SaTenantModuleToggle_tenantId_idx" ON "SaTenantModuleToggle"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SaPlanDefinition_key_key" ON "SaPlanDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SaPlanServiceLimit_planId_serviceKey_key" ON "SaPlanServiceLimit"("planId", "serviceKey");

-- CreateIndex
CREATE INDEX "SaPlanServiceLimit_serviceKey_idx" ON "SaPlanServiceLimit"("serviceKey");

-- CreateIndex
CREATE INDEX "SaTenantPlanSnapshot_tenantId_active_idx" ON "SaTenantPlanSnapshot"("tenantId", "active");

-- CreateIndex
CREATE INDEX "SaTenantPlanSnapshot_planId_idx" ON "SaTenantPlanSnapshot"("planId");

-- CreateIndex
CREATE INDEX "SaUsageEvent_tenantId_periodKey_idx" ON "SaUsageEvent"("tenantId", "periodKey");

-- CreateIndex
CREATE INDEX "SaUsageEvent_serviceKey_periodKey_idx" ON "SaUsageEvent"("serviceKey", "periodKey");

-- CreateIndex
CREATE INDEX "SaUsageEvent_createdAt_idx" ON "SaUsageEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaUsageCounter_tenantId_serviceKey_periodKey_key" ON "SaUsageCounter"("tenantId", "serviceKey", "periodKey");

-- CreateIndex
CREATE INDEX "SaUsageCounter_tenantId_periodKey_idx" ON "SaUsageCounter"("tenantId", "periodKey");

-- CreateIndex
CREATE INDEX "SaBillingEvent_tenantId_periodKey_idx" ON "SaBillingEvent"("tenantId", "periodKey");

-- CreateIndex
CREATE INDEX "SaBillingEvent_serviceKey_periodKey_idx" ON "SaBillingEvent"("serviceKey", "periodKey");

-- CreateIndex
CREATE INDEX "SaBillingEvent_createdAt_idx" ON "SaBillingEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaBillingCounter_tenantId_serviceKey_periodKey_key" ON "SaBillingCounter"("tenantId", "serviceKey", "periodKey");

-- CreateIndex
CREATE INDEX "SaBillingCounter_tenantId_periodKey_idx" ON "SaBillingCounter"("tenantId", "periodKey");

-- AddForeignKey
ALTER TABLE "SaUser" ADD CONSTRAINT "SaUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaTenantModuleToggle" ADD CONSTRAINT "SaTenantModuleToggle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaTenantModuleToggle" ADD CONSTRAINT "SaTenantModuleToggle_moduleKey_fkey" FOREIGN KEY ("moduleKey") REFERENCES "SaModuleDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaPlanServiceLimit" ADD CONSTRAINT "SaPlanServiceLimit_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SaPlanDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaTenantPlanSnapshot" ADD CONSTRAINT "SaTenantPlanSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaTenantPlanSnapshot" ADD CONSTRAINT "SaTenantPlanSnapshot_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SaPlanDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaUsageEvent" ADD CONSTRAINT "SaUsageEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaUsageCounter" ADD CONSTRAINT "SaUsageCounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaBillingEvent" ADD CONSTRAINT "SaBillingEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaBillingCounter" ADD CONSTRAINT "SaBillingCounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

