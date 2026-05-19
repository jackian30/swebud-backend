CREATE TYPE "buddy_discovery_audience" AS ENUM ('public', 'mutuals', 'close_buddies');

ALTER TABLE "buddy_sessions"
  ADD COLUMN "visible_to" "buddy_discovery_audience" NOT NULL DEFAULT 'public',
  ADD COLUMN "can_see" "buddy_discovery_audience" NOT NULL DEFAULT 'public';

CREATE INDEX "buddy_sessions_visible_to_expires_at_idx" ON "buddy_sessions"("visible_to", "expires_at");
CREATE INDEX "buddy_sessions_can_see_expires_at_idx" ON "buddy_sessions"("can_see", "expires_at");
