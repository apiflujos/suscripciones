ALTER TABLE "SaSession" ADD COLUMN IF NOT EXISTS "refreshTokenHash" TEXT;
ALTER TABLE "SaSession" ADD COLUMN IF NOT EXISTS "refreshExpiresAt" TIMESTAMP(3);
ALTER TABLE "SaSession" ADD COLUMN IF NOT EXISTS "refreshRotatedAt" TIMESTAMP(3);

DO $$ BEGIN
  CREATE UNIQUE INDEX "SaSession_refreshTokenHash_key" ON "SaSession"("refreshTokenHash");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
