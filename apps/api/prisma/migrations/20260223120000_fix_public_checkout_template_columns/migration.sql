-- Ensure PublicCheckoutTemplate has the columns expected by the Prisma schema.
-- Safe to run multiple times; uses IF NOT EXISTS.

ALTER TABLE "PublicCheckoutTemplate"
  ADD COLUMN IF NOT EXISTS "productIds" JSONB,
  ADD COLUMN IF NOT EXISTS "expiryHours" INTEGER,
  ADD COLUMN IF NOT EXISTS "logoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "wompiTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "wompiDescription" TEXT;
