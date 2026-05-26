ALTER TABLE "buddy_session_messages"
  ADD COLUMN "reference_type" TEXT,
  ADD COLUMN "reference_id" TEXT,
  ADD COLUMN "reference_text" TEXT,
  ADD COLUMN "reference_author_name" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by_id" TEXT;

CREATE TABLE "buddy_session_message_reactions" (
  "id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "buddy_session_message_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "buddy_session_message_reactions_message_id_user_id_emoji_key"
  ON "buddy_session_message_reactions"("message_id", "user_id", "emoji");

CREATE UNIQUE INDEX "buddy_session_message_reactions_message_id_user_id_key"
  ON "buddy_session_message_reactions"("message_id", "user_id");

CREATE INDEX "buddy_session_message_reactions_message_id_idx"
  ON "buddy_session_message_reactions"("message_id");

ALTER TABLE "buddy_session_message_reactions"
  ADD CONSTRAINT "buddy_session_message_reactions_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "buddy_session_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "buddy_session_message_reactions"
  ADD CONSTRAINT "buddy_session_message_reactions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "buddy_session_hidden_messages" (
  "message_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "hidden_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "buddy_session_hidden_messages_pkey" PRIMARY KEY ("message_id", "user_id")
);

CREATE INDEX "buddy_session_hidden_messages_user_id_hidden_at_idx"
  ON "buddy_session_hidden_messages"("user_id", "hidden_at");

ALTER TABLE "buddy_session_hidden_messages"
  ADD CONSTRAINT "buddy_session_hidden_messages_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "buddy_session_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "buddy_session_hidden_messages"
  ADD CONSTRAINT "buddy_session_hidden_messages_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
