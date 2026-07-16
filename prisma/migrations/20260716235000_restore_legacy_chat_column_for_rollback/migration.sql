-- Expand/contract compatibility: v0.2.43 still selects this nullable column.
-- Current Prisma Client ignores it and current APIs reject private-key input.
-- Drop it in a later release after the v0.2.43 rollback window is retired.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "chat_private_key" TEXT;

-- Some non-production databases may already have applied the original
-- coalescing migration. Remove its constraint so a v0.2.43 rollback retains
-- its historical duplicate-request behavior during the compatibility window.
DROP INDEX IF EXISTS "message_requests_one_pending_pair_key";
