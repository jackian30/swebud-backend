CREATE TABLE "buddy_session_recaps" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "room_id" TEXT NOT NULL,
  "room_name" TEXT NOT NULL,
  "scope" "buddy_session_scope" NOT NULL DEFAULT 'public',
  "group_id" TEXT,
  "group_name" TEXT,
  "group_slug" TEXT,
  "activity" TEXT,
  "sub_activity" TEXT,
  "title" TEXT NOT NULL,
  "caption" TEXT,
  "participant_count" INTEGER NOT NULL DEFAULT 1,
  "participant_preview" JSONB,
  "area_label" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3),
  "duration_seconds" INTEGER,
  "include_participants" BOOLEAN NOT NULL DEFAULT false,
  "include_broad_area" BOOLEAN NOT NULL DEFAULT false,
  "visibility" "post_visibility" NOT NULL DEFAULT 'only_me',
  "shared_post_id" TEXT,
  "shared_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "buddy_session_recaps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "buddy_session_recaps_shared_post_id_key" ON "buddy_session_recaps"("shared_post_id");
CREATE UNIQUE INDEX "buddy_session_recaps_owner_id_room_id_key" ON "buddy_session_recaps"("owner_id", "room_id");
CREATE INDEX "buddy_session_recaps_owner_id_created_at_idx" ON "buddy_session_recaps"("owner_id", "created_at");
CREATE INDEX "buddy_session_recaps_group_id_created_at_idx" ON "buddy_session_recaps"("group_id", "created_at");
CREATE INDEX "buddy_session_recaps_room_id_idx" ON "buddy_session_recaps"("room_id");

ALTER TABLE "buddy_session_recaps"
  ADD CONSTRAINT "buddy_session_recaps_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "buddy_session_recaps"
  ADD CONSTRAINT "buddy_session_recaps_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "buddy_session_recaps"
  ADD CONSTRAINT "buddy_session_recaps_shared_post_id_fkey"
  FOREIGN KEY ("shared_post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
