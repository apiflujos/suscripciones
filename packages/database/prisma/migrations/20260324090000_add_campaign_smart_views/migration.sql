-- Add smart view targeting for campaigns
ALTER TABLE "Campaign"
ADD COLUMN "smartViewId" UUID,
ADD COLUMN "smartViewFilters" JSONB;

CREATE INDEX "Campaign_smartViewId_idx" ON "Campaign"("smartViewId");

ALTER TABLE "Campaign"
ADD CONSTRAINT "Campaign_smartViewId_fkey"
FOREIGN KEY ("smartViewId") REFERENCES "SmartView"("id") ON DELETE SET NULL ON UPDATE CASCADE;
