ALTER TABLE "buddy_room_participants"
  ADD COLUMN "personal_pin_latitude" DOUBLE PRECISION,
  ADD COLUMN "personal_pin_longitude" DOUBLE PRECISION,
  ADD COLUMN "personal_pin_label" TEXT,
  ADD COLUMN "personal_pin_at" TIMESTAMP(3);

CREATE INDEX "buddy_room_participants_room_id_personal_pin_at_idx"
  ON "buddy_room_participants"("room_id", "personal_pin_at");
