-- Add missing columns for public checkout templates
ALTER TABLE "PublicCheckoutTemplate"
  ADD COLUMN IF NOT EXISTS "allowProductSelect" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PublicCheckoutTemplate"
  ADD COLUMN IF NOT EXISTS "layout" JSONB;
