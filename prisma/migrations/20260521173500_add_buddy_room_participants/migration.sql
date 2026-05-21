CREATE TABLE "buddy_room_participants" (
    "room_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buddy_room_participants_pkey" PRIMARY KEY ("room_id", "user_id")
);

UPDATE "buddy_rooms"
SET "visibility" = 'private'
WHERE "scope" = 'public';

INSERT INTO "buddy_room_participants" ("room_id", "user_id", "joined_at")
SELECT DISTINCT "room_id", "user_id", COALESCE("created_at", CURRENT_TIMESTAMP)
FROM "buddy_sessions"
WHERE "room_id" IS NOT NULL;

INSERT INTO "buddy_room_participants" ("room_id", "user_id", "joined_at")
SELECT "id", "creator_id", COALESCE("created_at", CURRENT_TIMESTAMP)
FROM "buddy_rooms"
ON CONFLICT ("room_id", "user_id") DO NOTHING;

CREATE INDEX "buddy_room_participants_user_id_idx" ON "buddy_room_participants"("user_id");

ALTER TABLE "buddy_room_participants" ADD CONSTRAINT "buddy_room_participants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "buddy_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "buddy_room_participants" ADD CONSTRAINT "buddy_room_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
