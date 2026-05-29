CREATE TYPE "buddy_room_participant_role" AS ENUM ('owner', 'admin', 'member');

ALTER TABLE "buddy_room_participants"
  ADD COLUMN "role" "buddy_room_participant_role" NOT NULL DEFAULT 'member',
  ADD COLUMN "last_activity_at" TIMESTAMP(3);

UPDATE "buddy_room_participants" participant
SET "role" = 'owner'
FROM "buddy_rooms" room
WHERE participant."room_id" = room."id"
  AND participant."user_id" = room."creator_id";

UPDATE "buddy_room_participants"
SET "last_activity_at" = COALESCE("joined_at", CURRENT_TIMESTAMP)
WHERE "last_activity_at" IS NULL;

UPDATE "buddy_room_participants" participant
SET "last_activity_at" = GREATEST(participant."last_activity_at", session."updated_at")
FROM "buddy_sessions" session
WHERE participant."room_id" = session."room_id"
  AND participant."user_id" = session."user_id";

ALTER TABLE "buddy_room_participants"
  ALTER COLUMN "last_activity_at" SET NOT NULL,
  ALTER COLUMN "last_activity_at" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "buddy_room_participants_room_id_role_last_activity_at_idx"
  ON "buddy_room_participants"("room_id", "role", "last_activity_at");

UPDATE "buddy_rooms" room
SET "expires_at" = GREATEST(room."expires_at", owner_activity."last_activity_at" + INTERVAL '5 hours')
FROM (
  SELECT "room_id", MAX("last_activity_at") AS "last_activity_at"
  FROM "buddy_room_participants"
  WHERE "role" IN ('owner', 'admin')
    AND "kicked_at" IS NULL
  GROUP BY "room_id"
) owner_activity
WHERE room."id" = owner_activity."room_id";
