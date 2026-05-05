ALTER TABLE "posts" ADD COLUMN "profile_owner_id" TEXT;

CREATE INDEX "posts_profile_owner_id_created_at_idx" ON "posts"("profile_owner_id", "created_at");

ALTER TABLE "posts" ADD CONSTRAINT "posts_profile_owner_id_fkey" FOREIGN KEY ("profile_owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
