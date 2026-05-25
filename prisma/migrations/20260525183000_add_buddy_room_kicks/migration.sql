ALTER TYPE "buddy_session_message_kind" ADD VALUE IF NOT EXISTS 'kicked';

ALTER TABLE "buddy_room_participants"
  ADD COLUMN "kicked_at" TIMESTAMP(3),
  ADD COLUMN "kicked_by_id" TEXT;

CREATE INDEX "buddy_room_participants_kicked_by_id_idx" ON "buddy_room_participants"("kicked_by_id");
