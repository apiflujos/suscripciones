-- AlterTable
ALTER TABLE "SaLimitDefinition" ADD COLUMN "moduleKey" TEXT;

-- CreateIndex
CREATE INDEX "SaLimitDefinition_moduleKey_idx" ON "SaLimitDefinition"("moduleKey");

