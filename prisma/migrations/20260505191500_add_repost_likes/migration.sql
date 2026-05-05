-- Add first-class repost notifications and likes.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'repost';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'repost_like';

ALTER TABLE "reposts" ADD COLUMN IF NOT EXISTS "like_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "reposts" DROP CONSTRAINT IF EXISTS "reposts_post_id_user_id_key";
CREATE INDEX IF NOT EXISTS "reposts_post_id_created_at_idx" ON "reposts"("post_id", "created_at");

CREATE TABLE IF NOT EXISTS "repost_likes" (
  "repost_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "repost_likes_pkey" PRIMARY KEY ("repost_id", "user_id"),
  CONSTRAINT "repost_likes_repost_id_fkey" FOREIGN KEY ("repost_id") REFERENCES "reposts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "repost_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "repost_likes_user_id_created_at_idx" ON "repost_likes"("user_id", "created_at");
