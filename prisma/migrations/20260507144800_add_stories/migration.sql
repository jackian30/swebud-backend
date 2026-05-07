CREATE TABLE "stories" (
  "id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "text" TEXT,
  "media_url" TEXT,
  "media_type" TEXT,
  "mime_type" TEXT,
  "filename" TEXT,
  "visibility" "post_visibility" NOT NULL DEFAULT 'public',
  "view_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "story_views" (
  "story_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_views_pkey" PRIMARY KEY ("story_id", "user_id")
);

CREATE INDEX "stories_author_id_created_at_idx" ON "stories"("author_id", "created_at");
CREATE INDEX "stories_visibility_expires_at_created_at_idx" ON "stories"("visibility", "expires_at", "created_at");
CREATE INDEX "story_views_user_id_viewed_at_idx" ON "story_views"("user_id", "viewed_at");

ALTER TABLE "stories" ADD CONSTRAINT "stories_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
