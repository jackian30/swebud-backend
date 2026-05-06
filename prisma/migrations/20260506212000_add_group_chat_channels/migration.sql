-- CreateTable
CREATE TABLE "group_chat_channels" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_chat_channels_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "channel_id" TEXT;

-- Backfill a default channel for existing groups.
INSERT INTO "group_chat_channels" ("id", "group_id", "creator_id", "name", "description")
SELECT
  md5(random()::text || clock_timestamp()::text || "groups"."id"),
  "groups"."id",
  COALESCE(
    (
      SELECT "group_members"."user_id"
      FROM "group_members"
      WHERE "group_members"."group_id" = "groups"."id"
      ORDER BY
        CASE "group_members"."role"
          WHEN 'owner' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'moderator' THEN 3
          ELSE 4
        END,
        "group_members"."joined_at" ASC
      LIMIT 1
    ),
    (
      SELECT "users"."id"
      FROM "users"
      ORDER BY "users"."created_at" ASC
      LIMIT 1
    )
  ),
  'general',
  'Group chat'
FROM "groups"
WHERE EXISTS (SELECT 1 FROM "users")
  AND NOT EXISTS (
    SELECT 1
    FROM "group_chat_channels"
    WHERE "group_chat_channels"."group_id" = "groups"."id"
      AND "group_chat_channels"."name" = 'general'
  );

UPDATE "messages"
SET "channel_id" = "default_channels"."id"
FROM (
  SELECT DISTINCT ON ("group_id") "id", "group_id"
  FROM "group_chat_channels"
  WHERE "name" = 'general'
  ORDER BY "group_id", "created_at" ASC
) AS "default_channels"
WHERE "messages"."group_id" = "default_channels"."group_id"
  AND "messages"."channel_id" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "group_chat_channels_group_id_name_key" ON "group_chat_channels"("group_id", "name");
CREATE INDEX "group_chat_channels_group_id_created_at_idx" ON "group_chat_channels"("group_id", "created_at");
CREATE INDEX "messages_channel_id_created_at_idx" ON "messages"("channel_id", "created_at");

-- AddForeignKey
ALTER TABLE "group_chat_channels" ADD CONSTRAINT "group_chat_channels_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_chat_channels" ADD CONSTRAINT "group_chat_channels_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "group_chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
