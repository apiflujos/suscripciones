-- CreateTable
CREATE TABLE "SmartView" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmartView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartViewItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "viewId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT,
    "type" TEXT,
    "meta" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmartViewItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmartView_tenantId_idx" ON "SmartView"("tenantId");

-- CreateIndex
CREATE INDEX "SmartViewItem_tenantId_idx" ON "SmartViewItem"("tenantId");

-- CreateIndex
CREATE INDEX "SmartViewItem_viewId_order_idx" ON "SmartViewItem"("viewId", "order");

-- AddForeignKey
ALTER TABLE "SmartView" ADD CONSTRAINT "SmartView_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartViewItem" ADD CONSTRAINT "SmartViewItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartViewItem" ADD CONSTRAINT "SmartViewItem_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "SmartView"("id") ON DELETE CASCADE ON UPDATE CASCADE;
