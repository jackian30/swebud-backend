CREATE TABLE "user_search_history" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "term" TEXT,
  "target_user_id" TEXT,
  "display_name" TEXT,
  "username" TEXT,
  "profile_image_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_search_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_search_history_user_id_updated_at_idx" ON "user_search_history"("user_id", "updated_at");
CREATE INDEX "user_search_history_target_user_id_idx" ON "user_search_history"("target_user_id");

ALTER TABLE "user_search_history"
  ADD CONSTRAINT "user_search_history_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_search_history"
  ADD CONSTRAINT "user_search_history_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
