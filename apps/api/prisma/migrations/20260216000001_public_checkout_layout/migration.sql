-- Add layout JSON for public checkout templates
ALTER TABLE "PublicCheckoutTemplate" ADD COLUMN "layout" JSONB;
