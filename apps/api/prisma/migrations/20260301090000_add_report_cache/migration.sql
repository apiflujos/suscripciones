-- CreateTable
CREATE TABLE "ReportCache" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reportKey" TEXT NOT NULL,
    "tenantId" UUID,
    "from" TIMESTAMPTZ NOT NULL,
    "to" TIMESTAMPTZ NOT NULL,
    "granularity" TEXT,
    "filtersHash" TEXT,
    "version" TEXT,
    "payload" JSONB NOT NULL,
    "computedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "staleAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CreateIndex
CREATE INDEX "ReportCache_reportKey_tenantId_idx" ON "ReportCache"("reportKey", "tenantId");

-- CreateIndex
CREATE INDEX "ReportCache_expiresAt_idx" ON "ReportCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCache_reportKey_tenantId_from_to_granularity_filtersHash_version_key"
ON "ReportCache"("reportKey", "tenantId", "from", "to", "granularity", "filtersHash", "version");
