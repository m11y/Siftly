-- AlterTable
ALTER TABLE "Bookmark" ADD COLUMN "quotedTweetId" TEXT;

-- CreateIndex
CREATE INDEX "Bookmark_quotedTweetId_idx" ON "Bookmark"("quotedTweetId");
