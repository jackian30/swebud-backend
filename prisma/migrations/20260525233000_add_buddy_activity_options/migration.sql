CREATE TABLE IF NOT EXISTS "buddy_activity_options" (
  "activity" "buddy_activity" PRIMARY KEY,
  "label" TEXT NOT NULL,
  "sub_activities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "buddy_activity_options_enabled_sort_order_idx"
ON "buddy_activity_options"("enabled", "sort_order");

INSERT INTO "buddy_activity_options" ("activity", "label", "sub_activities", "sort_order", "enabled")
VALUES
  ('running', 'Running', ARRAY['Easy run', 'Interval', 'Tempo run', 'Long run', 'Recovery run']::TEXT[], 10, TRUE),
  ('gym', 'Gym', ARRAY['Powerlifting', 'Weightlifting', 'Bodybuilding', 'Leg day', 'Back day', 'Push day', 'Pull day', 'SARMs day']::TEXT[], 20, TRUE),
  ('cycling', 'Cycling', ARRAY['Road ride', 'Intervals', 'Recovery ride', 'Long ride']::TEXT[], 30, TRUE),
  ('yoga', 'Yoga', ARRAY['Flow', 'Mobility', 'Recovery', 'Hot yoga']::TEXT[], 40, TRUE),
  ('walking', 'Walking', ARRAY['Casual walk', 'Brisk walk', 'Hike']::TEXT[], 50, TRUE),
  ('swimming', 'Swimming', ARRAY['Laps', 'Intervals', 'Open water']::TEXT[], 60, TRUE),
  ('hiking', 'Hiking', ARRAY['Trail hike', 'Hill walk', 'Backpacking']::TEXT[], 70, TRUE),
  ('climbing', 'Climbing', ARRAY['Bouldering', 'Top rope', 'Lead climbing']::TEXT[], 80, TRUE),
  ('martial_arts', 'Martial arts', ARRAY['Boxing', 'Muay Thai', 'BJJ', 'MMA', 'Karate', 'Taekwondo']::TEXT[], 90, TRUE),
  ('dance', 'Dance', ARRAY['Zumba', 'Hip-hop', 'Ballroom', 'Practice']::TEXT[], 100, TRUE),
  ('pilates', 'Pilates', ARRAY['Mat', 'Reformer', 'Core']::TEXT[], 110, TRUE),
  ('calisthenics', 'Calisthenics', ARRAY['Bodyweight', 'Pull day', 'Push day', 'Skill work']::TEXT[], 120, TRUE),
  ('rowing', 'Rowing', ARRAY['Erg', 'Intervals', 'Steady state', 'On water']::TEXT[], 130, TRUE),
  ('triathlon', 'Triathlon', ARRAY['Brick', 'Swim', 'Bike', 'Run']::TEXT[], 140, TRUE),
  ('soccer', 'Soccer', ARRAY['Pickup', 'Training', 'Match']::TEXT[], 150, TRUE),
  ('basketball', 'Basketball', ARRAY['Pickup', 'Shooting', 'Training', 'Game']::TEXT[], 160, TRUE),
  ('motorcycle_ride', 'Motorcycle ride', ARRAY['Short ride', 'Long ride', 'City ride', 'Scenic ride', 'Group ride']::TEXT[], 170, TRUE),
  ('vehicle_ride', 'Vehicle ride', ARRAY['Short drive', 'Long drive', 'City drive', 'Road trip', 'Group convoy']::TEXT[], 180, TRUE),
  ('sports', 'Sports', ARRAY['Football', 'Tennis', 'Badminton', 'Volleyball']::TEXT[], 190, TRUE),
  ('other', 'Other', ARRAY['Training', 'Recovery', 'Meetup']::TEXT[], 200, TRUE)
ON CONFLICT ("activity") DO UPDATE SET
  "label" = EXCLUDED."label",
  "sub_activities" = EXCLUDED."sub_activities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = EXCLUDED."enabled",
  "updated_at" = CURRENT_TIMESTAMP;
