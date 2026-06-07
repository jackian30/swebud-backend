ALTER TYPE "group_chat_channel_message_policy" ADD VALUE IF NOT EXISTS 'moderators';

ALTER TABLE "direct_chat_mutes" ADD COLUMN "muted_until" TIMESTAMP(3);
ALTER TABLE "group_chat_mutes" ADD COLUMN "muted_until" TIMESTAMP(3);
ALTER TABLE "group_chat_channel_mutes" ADD COLUMN "muted_until" TIMESTAMP(3);
ALTER TABLE "buddy_group_chat_mutes" ADD COLUMN "muted_until" TIMESTAMP(3);

CREATE TABLE "direct_chat_pins" (
    "user_id" TEXT NOT NULL,
    "peer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_chat_pins_pkey" PRIMARY KEY ("user_id","peer_id")
);

CREATE TABLE "group_chat_pins" (
    "user_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_chat_pins_pkey" PRIMARY KEY ("user_id","group_id")
);

CREATE TABLE "group_chat_channel_pins" (
    "user_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_chat_channel_pins_pkey" PRIMARY KEY ("user_id","channel_id")
);

CREATE TABLE "buddy_group_chat_pins" (
    "user_id" TEXT NOT NULL,
    "buddy_group_chat_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buddy_group_chat_pins_pkey" PRIMARY KEY ("user_id","buddy_group_chat_id")
);

CREATE TABLE "pinned_messages" (
    "user_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pinned_messages_pkey" PRIMARY KEY ("user_id","message_id")
);

CREATE TABLE "message_reports" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" "report_category" NOT NULL DEFAULT 'other',
    "note" TEXT,
    "details" TEXT,
    "status" "report_status" NOT NULL DEFAULT 'open',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "action_taken" TEXT,
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_reports_message_id_user_id_key" ON "message_reports"("message_id", "user_id");
CREATE INDEX "direct_chat_pins_peer_id_idx" ON "direct_chat_pins"("peer_id");
CREATE INDEX "group_chat_pins_group_id_idx" ON "group_chat_pins"("group_id");
CREATE INDEX "group_chat_channel_pins_group_id_idx" ON "group_chat_channel_pins"("group_id");
CREATE INDEX "group_chat_channel_pins_channel_id_idx" ON "group_chat_channel_pins"("channel_id");
CREATE INDEX "buddy_group_chat_pins_buddy_group_chat_id_idx" ON "buddy_group_chat_pins"("buddy_group_chat_id");
CREATE INDEX "pinned_messages_message_id_idx" ON "pinned_messages"("message_id");
CREATE INDEX "message_reports_status_category_created_at_idx" ON "message_reports"("status", "category", "created_at");
CREATE INDEX "message_reports_message_id_created_at_idx" ON "message_reports"("message_id", "created_at");
CREATE INDEX "message_reports_user_id_created_at_idx" ON "message_reports"("user_id", "created_at");

ALTER TABLE "direct_chat_pins" ADD CONSTRAINT "direct_chat_pins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_chat_pins" ADD CONSTRAINT "direct_chat_pins_peer_id_fkey" FOREIGN KEY ("peer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_chat_pins" ADD CONSTRAINT "group_chat_pins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_chat_pins" ADD CONSTRAINT "group_chat_pins_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_chat_channel_pins" ADD CONSTRAINT "group_chat_channel_pins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_chat_channel_pins" ADD CONSTRAINT "group_chat_channel_pins_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_chat_channel_pins" ADD CONSTRAINT "group_chat_channel_pins_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "group_chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "buddy_group_chat_pins" ADD CONSTRAINT "buddy_group_chat_pins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "buddy_group_chat_pins" ADD CONSTRAINT "buddy_group_chat_pins_buddy_group_chat_id_fkey" FOREIGN KEY ("buddy_group_chat_id") REFERENCES "buddy_group_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
