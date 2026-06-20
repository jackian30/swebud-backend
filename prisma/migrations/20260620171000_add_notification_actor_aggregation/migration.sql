ALTER TABLE "notifications"
  ADD COLUMN "actor_ids" JSONB;

UPDATE "notifications"
SET "actor_ids" = jsonb_build_array("actor_id")
WHERE "actor_id" IS NOT NULL
  AND "actor_ids" IS NULL;

CREATE INDEX "notifications_user_id_type_entity_id_read_at_idx"
  ON "notifications"("user_id", "type", "entity_id", "read_at");
