CREATE TABLE "hidden_messages" (
  "message_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hidden_messages_pkey" PRIMARY KEY ("message_id", "user_id")
);

CREATE INDEX "hidden_messages_user_id_created_at_idx" ON "hidden_messages"("user_id", "created_at");

ALTER TABLE "hidden_messages" ADD CONSTRAINT "hidden_messages_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hidden_messages" ADD CONSTRAINT "hidden_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
