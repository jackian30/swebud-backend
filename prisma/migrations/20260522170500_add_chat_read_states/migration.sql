CREATE TABLE "group_chat_read_states" (
  "user_id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "last_read_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "group_chat_read_states_pkey" PRIMARY KEY ("user_id", "channel_id")
);

CREATE TABLE "buddy_group_chat_read_states" (
  "user_id" TEXT NOT NULL,
  "buddy_group_chat_id" TEXT NOT NULL,
  "last_read_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "buddy_group_chat_read_states_pkey" PRIMARY KEY ("user_id", "buddy_group_chat_id")
);

CREATE INDEX "group_chat_read_states_group_id_channel_id_idx" ON "group_chat_read_states"("group_id", "channel_id");
CREATE INDEX "buddy_group_chat_read_states_buddy_group_chat_id_idx" ON "buddy_group_chat_read_states"("buddy_group_chat_id");

ALTER TABLE "group_chat_read_states"
  ADD CONSTRAINT "group_chat_read_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_chat_read_states"
  ADD CONSTRAINT "group_chat_read_states_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_chat_read_states"
  ADD CONSTRAINT "group_chat_read_states_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "group_chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "buddy_group_chat_read_states"
  ADD CONSTRAINT "buddy_group_chat_read_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "buddy_group_chat_read_states"
  ADD CONSTRAINT "buddy_group_chat_read_states_buddy_group_chat_id_fkey"
  FOREIGN KEY ("buddy_group_chat_id") REFERENCES "buddy_group_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
