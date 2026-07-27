ALTER TABLE "messages"
  ADD COLUMN "moderation_status" "content_moderation_status" NOT NULL DEFAULT 'active',
  ADD COLUMN "quarantined_at" TIMESTAMP(3),
  ADD COLUMN "quarantined_by_id" TEXT,
  ADD COLUMN "quarantine_reason" TEXT;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_moderation_state_check"
  CHECK (
    (
      "moderation_status" = 'active'
      AND "quarantined_at" IS NULL
      AND "quarantined_by_id" IS NULL
      AND "quarantine_reason" IS NULL
    )
    OR
    (
      "moderation_status" = 'quarantined'
      AND "quarantined_at" IS NOT NULL
      AND "quarantined_by_id" IS NOT NULL
      AND "quarantine_reason" IS NOT NULL
      AND length(btrim("quarantine_reason")) > 0
    )
  );

CREATE INDEX "messages_moderation_status_created_at_idx"
  ON "messages"("moderation_status", "created_at");
