CREATE TABLE "post_edit_history" (
  "id" TEXT NOT NULL,
  "post_id" TEXT NOT NULL,
  "editor_id" TEXT NOT NULL,
  "old_text" TEXT,
  "new_text" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_edit_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "comment_edit_history" (
  "id" TEXT NOT NULL,
  "comment_id" TEXT NOT NULL,
  "editor_id" TEXT NOT NULL,
  "old_body" TEXT NOT NULL,
  "new_body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comment_edit_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "post_edit_history_post_id_created_at_idx" ON "post_edit_history"("post_id", "created_at");
CREATE INDEX "comment_edit_history_comment_id_created_at_idx" ON "comment_edit_history"("comment_id", "created_at");

ALTER TABLE "post_edit_history" ADD CONSTRAINT "post_edit_history_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comment_edit_history" ADD CONSTRAINT "comment_edit_history_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
