-- AlterTable
ALTER TABLE "Bookmark" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'x';

-- CreateIndex
CREATE INDEX "Bookmark_platform_idx" ON "Bookmark"("platform");
