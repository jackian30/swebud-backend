CREATE TYPE "buddy_session_message_kind" AS ENUM ('text', 'gif', 'sticker');

CREATE TABLE "buddy_session_messages" (
  "id" TEXT NOT NULL,
  "room_id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "kind" "buddy_session_message_kind" NOT NULL DEFAULT 'text',
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "buddy_session_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "buddy_session_messages_room_id_created_at_idx" ON "buddy_session_messages"("room_id", "created_at");
CREATE INDEX "buddy_session_messages_sender_id_created_at_idx" ON "buddy_session_messages"("sender_id", "created_at");

ALTER TABLE "buddy_session_messages"
  ADD CONSTRAINT "buddy_session_messages_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "buddy_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "buddy_session_messages"
  ADD CONSTRAINT "buddy_session_messages_sender_id_fkey"
  FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
