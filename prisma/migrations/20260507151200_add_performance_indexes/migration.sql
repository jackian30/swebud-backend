-- Feed, story, and relationship lookup indexes.
-- These match the high-traffic query shapes used by feed ranking,
-- story listing, trending stats, media includes, and privacy checks.

CREATE INDEX "post_images_post_id_sort_order_idx" ON "post_images"("post_id", "sort_order");

CREATE INDEX "stories_expires_at_created_at_idx" ON "stories"("expires_at", "created_at");

CREATE INDEX "post_hashtags_hashtag_id_idx" ON "post_hashtags"("hashtag_id");

CREATE INDEX "post_likes_post_id_created_at_idx" ON "post_likes"("post_id", "created_at");
CREATE INDEX "post_likes_user_id_created_at_idx" ON "post_likes"("user_id", "created_at");

CREATE INDEX "comment_likes_user_id_created_at_idx" ON "comment_likes"("user_id", "created_at");

CREATE INDEX "hidden_posts_user_id_created_at_idx" ON "hidden_posts"("user_id", "created_at");

CREATE INDEX "post_reports_post_id_created_at_idx" ON "post_reports"("post_id", "created_at");
CREATE INDEX "post_reports_user_id_created_at_idx" ON "post_reports"("user_id", "created_at");

CREATE INDEX "blocks_blocked_id_idx" ON "blocks"("blocked_id");

CREATE INDEX "groups_visibility_created_at_idx" ON "groups"("visibility", "created_at");

CREATE INDEX "group_members_user_id_joined_at_idx" ON "group_members"("user_id", "joined_at");

CREATE INDEX "messages_recipient_id_read_at_idx" ON "messages"("recipient_id", "read_at");
