CREATE TABLE "direct_chat_mutes" (
    "user_id" TEXT NOT NULL,
    "peer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_chat_mutes_pkey" PRIMARY KEY ("user_id","peer_id")
);

CREATE TABLE "group_chat_mutes" (
    "user_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_chat_mutes_pkey" PRIMARY KEY ("user_id","group_id")
);

CREATE TABLE "group_chat_channel_mutes" (
    "user_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_chat_channel_mutes_pkey" PRIMARY KEY ("user_id","channel_id")
);

CREATE TABLE "buddy_group_chat_mutes" (
    "user_id" TEXT NOT NULL,
    "buddy_group_chat_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buddy_group_chat_mutes_pkey" PRIMARY KEY ("user_id","buddy_group_chat_id")
);

CREATE INDEX "direct_chat_mutes_peer_id_idx" ON "direct_chat_mutes"("peer_id");
CREATE INDEX "group_chat_mutes_group_id_idx" ON "group_chat_mutes"("group_id");
CREATE INDEX "group_chat_channel_mutes_group_id_idx" ON "group_chat_channel_mutes"("group_id");
CREATE INDEX "group_chat_channel_mutes_channel_id_idx" ON "group_chat_channel_mutes"("channel_id");
CREATE INDEX "buddy_group_chat_mutes_buddy_group_chat_id_idx" ON "buddy_group_chat_mutes"("buddy_group_chat_id");

ALTER TABLE "direct_chat_mutes"
  ADD CONSTRAINT "direct_chat_mutes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "direct_chat_mutes"
  ADD CONSTRAINT "direct_chat_mutes_peer_id_fkey"
  FOREIGN KEY ("peer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_chat_mutes"
  ADD CONSTRAINT "group_chat_mutes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_chat_mutes"
  ADD CONSTRAINT "group_chat_mutes_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_chat_channel_mutes"
  ADD CONSTRAINT "group_chat_channel_mutes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_chat_channel_mutes"
  ADD CONSTRAINT "group_chat_channel_mutes_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_chat_channel_mutes"
  ADD CONSTRAINT "group_chat_channel_mutes_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "group_chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "buddy_group_chat_mutes"
  ADD CONSTRAINT "buddy_group_chat_mutes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "buddy_group_chat_mutes"
  ADD CONSTRAINT "buddy_group_chat_mutes_buddy_group_chat_id_fkey"
  FOREIGN KEY ("buddy_group_chat_id") REFERENCES "buddy_group_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
