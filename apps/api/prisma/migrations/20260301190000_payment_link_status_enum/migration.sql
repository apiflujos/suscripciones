-- Create enum for PaymentLink.status
DO $$ BEGIN
  CREATE TYPE "PaymentLinkStatus" AS ENUM ('SENT', 'PAID', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Normalize existing values (defensive)
UPDATE "PaymentLink"
SET "status" = 'SENT'
WHERE "status" IS NULL
   OR "status" NOT IN ('SENT', 'PAID', 'FAILED');

-- Drop default before type change (avoids cast error)
ALTER TABLE "PaymentLink"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "PaymentLink"
  ALTER COLUMN "status" TYPE "PaymentLinkStatus" USING ("status"::"PaymentLinkStatus");

ALTER TABLE "PaymentLink"
  ALTER COLUMN "status" SET DEFAULT 'SENT';
