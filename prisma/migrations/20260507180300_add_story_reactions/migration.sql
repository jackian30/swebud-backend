CREATE TABLE "story_reactions" (
  "story_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "story_reactions_pkey" PRIMARY KEY ("story_id", "user_id")
);

CREATE INDEX "story_reactions_story_id_emoji_idx" ON "story_reactions"("story_id", "emoji");
CREATE INDEX "story_reactions_user_id_updated_at_idx" ON "story_reactions"("user_id", "updated_at");

ALTER TABLE "story_reactions" ADD CONSTRAINT "story_reactions_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_reactions" ADD CONSTRAINT "story_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
