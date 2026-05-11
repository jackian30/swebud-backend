CREATE TABLE "buddy_group_chats" (
  "id" TEXT NOT NULL,
  "creator_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "buddy_group_chats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "buddy_group_chat_members" (
  "buddy_group_chat_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "added_by_id" TEXT,
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "buddy_group_chat_members_pkey" PRIMARY KEY ("buddy_group_chat_id", "user_id")
);

ALTER TABLE "messages" ADD COLUMN "buddy_group_chat_id" TEXT;

CREATE INDEX "buddy_group_chats_creator_id_created_at_idx" ON "buddy_group_chats"("creator_id", "created_at");
CREATE INDEX "buddy_group_chat_members_user_id_joined_at_idx" ON "buddy_group_chat_members"("user_id", "joined_at");
CREATE INDEX "messages_buddy_group_chat_id_created_at_idx" ON "messages"("buddy_group_chat_id", "created_at");

ALTER TABLE "buddy_group_chats"
  ADD CONSTRAINT "buddy_group_chats_creator_id_fkey"
  FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "buddy_group_chat_members"
  ADD CONSTRAINT "buddy_group_chat_members_buddy_group_chat_id_fkey"
  FOREIGN KEY ("buddy_group_chat_id") REFERENCES "buddy_group_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "buddy_group_chat_members"
  ADD CONSTRAINT "buddy_group_chat_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_buddy_group_chat_id_fkey"
  FOREIGN KEY ("buddy_group_chat_id") REFERENCES "buddy_group_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
