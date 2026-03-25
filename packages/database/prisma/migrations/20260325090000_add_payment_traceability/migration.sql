-- Add enums for payment traceability
CREATE TYPE "PaymentOrigin" AS ENUM ('AUTO_DEBIT', 'AUTO_LINK', 'MANUAL_LINK', 'MANUAL_USER', 'WEBHOOK');
CREATE TYPE "PaymentAssociationReason" AS ENUM ('LINK_MATCH', 'TX_MATCH', 'REF_MATCH', 'SUB_REF', 'IDENTITY_MATCH', 'MANUAL_RECONCILE', 'UNLINKED', 'UNKNOWN');

ALTER TABLE "Payment"
  ADD COLUMN "origin" "PaymentOrigin" NOT NULL DEFAULT 'WEBHOOK',
  ADD COLUMN "associationReason" "PaymentAssociationReason",
  ADD COLUMN "associatedBy" TEXT;
