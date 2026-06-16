ALTER TABLE "buddy_rooms"
  ADD COLUMN "pinned_latitude" DOUBLE PRECISION,
  ADD COLUMN "pinned_longitude" DOUBLE PRECISION,
  ADD COLUMN "pinned_label" TEXT,
  ADD COLUMN "pinned_by_id" TEXT,
  ADD COLUMN "pinned_at" TIMESTAMP(3);

CREATE INDEX "buddy_rooms_pinned_at_idx" ON "buddy_rooms"("pinned_at");
