-- AlterEnum
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'CUSTOM';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'MERCADOPAGO';

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "provider" "WebhookProvider" NOT NULL,
  "name" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "secretSalt" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_path_key" ON "WebhookEndpoint"("path");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_tenantId_idx" ON "WebhookEndpoint"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_provider_idx" ON "WebhookEndpoint"("provider");

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "SaTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
