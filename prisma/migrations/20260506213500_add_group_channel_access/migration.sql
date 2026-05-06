-- CreateEnum
CREATE TYPE "group_chat_channel_visibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "group_chat_channel_message_policy" AS ENUM ('everyone', 'admins');

-- AlterTable
ALTER TABLE "group_chat_channels" ADD COLUMN "visibility" "group_chat_channel_visibility" NOT NULL DEFAULT 'public';
ALTER TABLE "group_chat_channels" ADD COLUMN "message_policy" "group_chat_channel_message_policy" NOT NULL DEFAULT 'everyone';

-- Rename the legacy default channel to Main where that does not conflict.
UPDATE "group_chat_channels" AS channel
SET "name" = 'main',
    "description" = COALESCE(NULLIF(channel."description", ''), 'Main channel')
WHERE channel."name" = 'general'
  AND NOT EXISTS (
    SELECT 1
    FROM "group_chat_channels" AS existing
    WHERE existing."group_id" = channel."group_id"
      AND existing."name" = 'main'
  );

-- CreateTable
CREATE TABLE "group_chat_channel_members" (
    "channel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_chat_channel_members_pkey" PRIMARY KEY ("channel_id","user_id")
);

-- CreateIndex
CREATE INDEX "group_chat_channel_members_user_id_idx" ON "group_chat_channel_members"("user_id");

-- AddForeignKey
ALTER TABLE "group_chat_channel_members" ADD CONSTRAINT "group_chat_channel_members_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "group_chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_chat_channel_members" ADD CONSTRAINT "group_chat_channel_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
