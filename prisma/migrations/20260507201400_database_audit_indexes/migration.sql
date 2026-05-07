-- Database audit indexes for high-traffic app paths:
-- - direct chat list/conversation/unread lookups
-- - active session/password reset maintenance
-- - user search and empty search ordering

CREATE INDEX IF NOT EXISTS "users_created_at_idx" ON "users"("created_at");

CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_revoked_at_expires_at_idx"
ON "refresh_tokens"("user_id", "revoked_at", "expires_at");

CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_used_at_expires_at_idx"
ON "password_reset_tokens"("user_id", "used_at", "expires_at");

CREATE INDEX IF NOT EXISTS "messages_recipient_id_sender_id_created_at_idx"
ON "messages"("recipient_id", "sender_id", "created_at");

CREATE INDEX IF NOT EXISTS "messages_recipient_id_sender_id_read_at_idx"
ON "messages"("recipient_id", "sender_id", "read_at");

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "users_username_trgm_idx"
ON "users" USING gin ("username" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "users_display_name_trgm_idx"
ON "users" USING gin ("display_name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "users_email_trgm_idx"
ON "users" USING gin ("email" gin_trgm_ops);
