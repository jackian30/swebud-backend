ALTER TABLE "buddy_room_participants"
  ADD COLUMN "left_at" TIMESTAMP(3);

WITH latest_events AS (
  SELECT
    participant."room_id",
    participant."user_id",
    MAX(message."created_at") FILTER (WHERE message."kind" = 'left') AS "last_left_at",
    MAX(message."created_at") FILTER (WHERE message."kind" = 'joined') AS "last_joined_at"
  FROM "buddy_room_participants" participant
  LEFT JOIN "buddy_session_messages" message
    ON message."room_id" = participant."room_id"
   AND message."sender_id" = participant."user_id"
   AND message."kind" IN ('joined', 'left')
  GROUP BY participant."room_id", participant."user_id"
)
UPDATE "buddy_room_participants" participant
SET "left_at" = latest_events."last_left_at"
FROM latest_events
WHERE participant."room_id" = latest_events."room_id"
  AND participant."user_id" = latest_events."user_id"
  AND participant."left_at" IS NULL
  AND participant."kicked_at" IS NULL
  AND latest_events."last_left_at" IS NOT NULL
  AND (
    latest_events."last_joined_at" IS NULL
    OR latest_events."last_left_at" > latest_events."last_joined_at"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "buddy_sessions" session
    WHERE session."room_id" = participant."room_id"
      AND session."user_id" = participant."user_id"
      AND session."expires_at" > CURRENT_TIMESTAMP
  );

CREATE INDEX "buddy_room_participants_room_id_left_at_idx"
  ON "buddy_room_participants"("room_id", "left_at");
