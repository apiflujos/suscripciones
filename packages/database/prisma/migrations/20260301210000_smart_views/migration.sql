DO $$ BEGIN
  CREATE TYPE "SmartViewVisibility" AS ENUM ('PRIVATE', 'ORG');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "SmartViewType" AS ENUM ('DYNAMIC', 'STATIC');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "SmartView" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "visibility" "SmartViewVisibility" NOT NULL DEFAULT 'ORG',
  "type" "SmartViewType" NOT NULL DEFAULT 'DYNAMIC',
  "filters" JSONB,
  "staticCount" INTEGER NOT NULL DEFAULT 0,
  "createdByEmail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartView_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SmartViewItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "smartViewId" UUID NOT NULL,
  "itemId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartViewItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SmartView" ADD CONSTRAINT "SmartView_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartViewItem" ADD CONSTRAINT "SmartViewItem_smartViewId_fkey" FOREIGN KEY ("smartViewId") REFERENCES "SmartView"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  CREATE INDEX "SmartView_tenantId_scope_visibility_idx" ON "SmartView"("tenantId","scope","visibility");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX "SmartView_tenantId_scope_idx" ON "SmartView"("tenantId","scope");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX "SmartViewItem_smartViewId_itemId_key" ON "SmartViewItem"("smartViewId","itemId");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX "SmartViewItem_itemId_idx" ON "SmartViewItem"("itemId");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
