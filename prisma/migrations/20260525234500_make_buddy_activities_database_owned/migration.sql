ALTER TABLE "buddy_sessions"
ALTER COLUMN "activity" TYPE TEXT USING "activity"::TEXT;

ALTER TABLE "buddy_rooms"
ALTER COLUMN "activity" TYPE TEXT USING "activity"::TEXT;

ALTER TABLE "buddy_activity_options"
ALTER COLUMN "activity" TYPE TEXT USING "activity"::TEXT;
