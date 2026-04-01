-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "matchScore" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "matchCriteria" JSONB;
