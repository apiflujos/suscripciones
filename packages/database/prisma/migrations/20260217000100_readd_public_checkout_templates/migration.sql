DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PublicCheckoutKind') THEN
        CREATE TYPE "PublicCheckoutKind" AS ENUM ('PLAN', 'SUBSCRIPTION');
    END IF;
END$$;

DROP TABLE IF EXISTS "PublicCheckoutTemplate";

CREATE TABLE "PublicCheckoutTemplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "kind" "PublicCheckoutKind" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "allowProductSelect" BOOLEAN NOT NULL DEFAULT false,
  "productIds" JSONB,
  "expiryHours" INTEGER,
  "logoUrl" TEXT,
  "wompiTitle" TEXT,
  "wompiDescription" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PublicCheckoutTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublicCheckoutTemplate_active_kind_idx" ON "PublicCheckoutTemplate"("active", "kind");
