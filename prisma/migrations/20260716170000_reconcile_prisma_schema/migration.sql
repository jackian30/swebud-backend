-- The repost feature permits multiple reposts of the same post by one user.
-- The original migration attempted to drop this as a table constraint, but
-- Prisma created it as a standalone unique index.
DROP INDEX IF EXISTS "reposts_post_id_user_id_key";

-- Buddy activities became database-owned text values in 0.2.20. No columns
-- use the legacy enum after that conversion.
DROP TYPE IF EXISTS "buddy_activity";
