-- CreateEnum
CREATE TYPE "PublicCheckoutKind" AS ENUM ('PLAN', 'SUBSCRIPTION');

-- CreateTable
CREATE TABLE "PublicCheckoutTemplate" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "PublicCheckoutKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "planId" UUID,
    "allowPlanSelect" BOOLEAN NOT NULL DEFAULT false,
    "requireShipping" BOOLEAN NOT NULL DEFAULT false,
    "requireAddress" BOOLEAN NOT NULL DEFAULT false,
    "branding" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicCheckoutTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicCheckoutTemplate_slug_key" ON "PublicCheckoutTemplate"("slug");

-- CreateIndex
CREATE INDEX "PublicCheckoutTemplate_active_kind_idx" ON "PublicCheckoutTemplate"("active", "kind");

-- AddForeignKey
ALTER TABLE "PublicCheckoutTemplate" ADD CONSTRAINT "PublicCheckoutTemplate_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
