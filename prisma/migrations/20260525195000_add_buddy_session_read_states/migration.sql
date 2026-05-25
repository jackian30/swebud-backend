CREATE TABLE "buddy_session_read_states" (
  "room_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "last_read_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "buddy_session_read_states_pkey" PRIMARY KEY ("room_id", "user_id")
);

CREATE INDEX "buddy_session_read_states_user_id_last_read_at_idx" ON "buddy_session_read_states"("user_id", "last_read_at");

ALTER TABLE "buddy_session_read_states"
  ADD CONSTRAINT "buddy_session_read_states_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "buddy_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "buddy_session_read_states"
  ADD CONSTRAINT "buddy_session_read_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
