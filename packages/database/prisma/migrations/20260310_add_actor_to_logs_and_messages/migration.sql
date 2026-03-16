-- AlterTable
ALTER TABLE "SystemLog" ADD COLUMN "actor" TEXT;

-- AlterTable
ALTER TABLE "ChatwootMessage" ADD COLUMN "actor" TEXT;

-- CreateIndex
CREATE INDEX "SystemLog_actor_createdAt_idx" ON "SystemLog"("actor", "createdAt");

-- CreateIndex
CREATE INDEX "ChatwootMessage_actor_createdAt_idx" ON "ChatwootMessage"("actor", "createdAt");
