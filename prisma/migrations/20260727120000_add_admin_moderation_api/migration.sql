CREATE TYPE "content_moderation_status" AS ENUM ('active', 'quarantined');
CREATE TYPE "moderation_report_type" AS ENUM ('post', 'user', 'group', 'message');
CREATE TYPE "report_appeal_status" AS ENUM ('submitted', 'under_review', 'upheld', 'overturned', 'dismissed', 'withdrawn');

ALTER TABLE "posts"
  ADD COLUMN "moderation_status" "content_moderation_status" NOT NULL DEFAULT 'active',
  ADD COLUMN "quarantined_at" TIMESTAMP(3),
  ADD COLUMN "quarantined_by_id" TEXT,
  ADD COLUMN "quarantine_reason" TEXT;

ALTER TABLE "groups"
  ADD COLUMN "moderation_status" "content_moderation_status" NOT NULL DEFAULT 'active',
  ADD COLUMN "quarantined_at" TIMESTAMP(3),
  ADD COLUMN "quarantined_by_id" TEXT,
  ADD COLUMN "quarantine_reason" TEXT;

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_moderation_state_check"
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

ALTER TABLE "groups"
  ADD CONSTRAINT "groups_moderation_state_check"
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

CREATE INDEX "posts_moderation_status_created_at_idx"
  ON "posts"("moderation_status", "created_at");
CREATE INDEX "groups_moderation_status_created_at_idx"
  ON "groups"("moderation_status", "created_at");

ALTER TABLE "post_reports"
  ADD COLUMN "assigned_reviewer_id" TEXT,
  ADD COLUMN "assigned_at" TIMESTAMP(3),
  ADD COLUMN "sla_due_at" TIMESTAMP(3),
  ADD COLUMN "escalation_level" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "escalated_at" TIMESTAMP(3),
  ADD COLUMN "escalated_by_id" TEXT,
  ADD COLUMN "escalation_reason" TEXT;

ALTER TABLE "user_reports"
  ADD COLUMN "assigned_reviewer_id" TEXT,
  ADD COLUMN "assigned_at" TIMESTAMP(3),
  ADD COLUMN "sla_due_at" TIMESTAMP(3),
  ADD COLUMN "escalation_level" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "escalated_at" TIMESTAMP(3),
  ADD COLUMN "escalated_by_id" TEXT,
  ADD COLUMN "escalation_reason" TEXT;

ALTER TABLE "group_reports"
  ADD COLUMN "assigned_reviewer_id" TEXT,
  ADD COLUMN "assigned_at" TIMESTAMP(3),
  ADD COLUMN "sla_due_at" TIMESTAMP(3),
  ADD COLUMN "escalation_level" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "escalated_at" TIMESTAMP(3),
  ADD COLUMN "escalated_by_id" TEXT,
  ADD COLUMN "escalation_reason" TEXT;

ALTER TABLE "message_reports"
  ADD COLUMN "assigned_reviewer_id" TEXT,
  ADD COLUMN "assigned_at" TIMESTAMP(3),
  ADD COLUMN "sla_due_at" TIMESTAMP(3),
  ADD COLUMN "escalation_level" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "escalated_at" TIMESTAMP(3),
  ADD COLUMN "escalated_by_id" TEXT,
  ADD COLUMN "escalation_reason" TEXT;

CREATE INDEX "post_reports_assigned_reviewer_id_status_created_at_idx"
  ON "post_reports"("assigned_reviewer_id", "status", "created_at");
CREATE INDEX "post_reports_sla_due_at_status_idx"
  ON "post_reports"("sla_due_at", "status");
CREATE INDEX "post_reports_escalation_level_status_created_at_idx"
  ON "post_reports"("escalation_level", "status", "created_at");
CREATE INDEX "user_reports_assigned_reviewer_id_status_created_at_idx"
  ON "user_reports"("assigned_reviewer_id", "status", "created_at");
CREATE INDEX "user_reports_sla_due_at_status_idx"
  ON "user_reports"("sla_due_at", "status");
CREATE INDEX "user_reports_escalation_level_status_created_at_idx"
  ON "user_reports"("escalation_level", "status", "created_at");
CREATE INDEX "group_reports_assigned_reviewer_id_status_created_at_idx"
  ON "group_reports"("assigned_reviewer_id", "status", "created_at");
CREATE INDEX "group_reports_sla_due_at_status_idx"
  ON "group_reports"("sla_due_at", "status");
CREATE INDEX "group_reports_escalation_level_status_created_at_idx"
  ON "group_reports"("escalation_level", "status", "created_at");
CREATE INDEX "message_reports_assigned_reviewer_id_status_created_at_idx"
  ON "message_reports"("assigned_reviewer_id", "status", "created_at");
CREATE INDEX "message_reports_sla_due_at_status_idx"
  ON "message_reports"("sla_due_at", "status");
CREATE INDEX "message_reports_escalation_level_status_created_at_idx"
  ON "message_reports"("escalation_level", "status", "created_at");

CREATE TABLE "admin_report_internal_notes" (
  "id" TEXT NOT NULL,
  "report_type" "moderation_report_type" NOT NULL,
  "report_id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_report_internal_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_report_internal_notes_report_type_report_id_created_a_idx"
  ON "admin_report_internal_notes"("report_type", "report_id", "created_at");

CREATE TABLE "admin_report_appeals" (
  "id" TEXT NOT NULL,
  "report_type" "moderation_report_type" NOT NULL,
  "report_id" TEXT NOT NULL,
  "appellant_user_id" TEXT,
  "statement" TEXT NOT NULL,
  "status" "report_appeal_status" NOT NULL DEFAULT 'submitted',
  "assigned_reviewer_id" TEXT,
  "assigned_at" TIMESTAMP(3),
  "reviewed_at" TIMESTAMP(3),
  "reviewed_by_id" TEXT,
  "resolution_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "admin_report_appeals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_report_appeals_report_type_report_id_created_at_idx"
  ON "admin_report_appeals"("report_type", "report_id", "created_at");
CREATE INDEX "admin_report_appeals_status_created_at_idx"
  ON "admin_report_appeals"("status", "created_at");
CREATE INDEX "admin_report_appeals_assigned_reviewer_id_status_created_at_idx"
  ON "admin_report_appeals"("assigned_reviewer_id", "status", "created_at");

CREATE TABLE "admin_report_evidence" (
  "id" TEXT NOT NULL,
  "report_type" "moderation_report_type" NOT NULL,
  "report_id" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "media_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "metadata" JSONB NOT NULL,
  "retention_expires_at" TIMESTAMP(3) NOT NULL,
  "legal_hold" BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "admin_report_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_report_evidence_report_type_report_id_created_at_idx"
  ON "admin_report_evidence"("report_type", "report_id", "created_at");
CREATE INDEX "admin_report_evidence_retention_expires_at_legal_hold_idx"
  ON "admin_report_evidence"("retention_expires_at", "legal_hold");

CREATE TABLE "admin_jwt_jtis" (
  "jti" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_jwt_jtis_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX "admin_jwt_jtis_expires_at_idx"
  ON "admin_jwt_jtis"("expires_at");
CREATE INDEX "admin_jwt_jtis_actor_id_created_at_idx"
  ON "admin_jwt_jtis"("actor_id", "created_at");

CREATE TABLE "admin_idempotency_records" (
  "id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "response" JSONB,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_idempotency_records_actor_id_key_key"
  ON "admin_idempotency_records"("actor_id", "key");
CREATE UNIQUE INDEX "admin_idempotency_records_request_id_key"
  ON "admin_idempotency_records"("request_id");
CREATE INDEX "admin_idempotency_records_expires_at_idx"
  ON "admin_idempotency_records"("expires_at");

CREATE TABLE "admin_audit_events" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "actor_jti" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_audit_events_request_id_key"
  ON "admin_audit_events"("request_id");
CREATE INDEX "admin_audit_events_actor_id_created_at_idx"
  ON "admin_audit_events"("actor_id", "created_at");
CREATE INDEX "admin_audit_events_target_type_target_id_created_at_idx"
  ON "admin_audit_events"("target_type", "target_id", "created_at");

CREATE TABLE "admin_outbox_events" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "admin_outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_outbox_events_request_id_key"
  ON "admin_outbox_events"("request_id");
CREATE INDEX "admin_outbox_events_published_at_created_at_idx"
  ON "admin_outbox_events"("published_at", "created_at");

CREATE FUNCTION "prevent_admin_audit_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin audit events are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "admin_audit_events_immutable"
BEFORE UPDATE OR DELETE ON "admin_audit_events"
FOR EACH ROW
EXECUTE FUNCTION "prevent_admin_audit_event_mutation"();

CREATE TRIGGER "admin_report_internal_notes_immutable"
BEFORE UPDATE OR DELETE ON "admin_report_internal_notes"
FOR EACH ROW
EXECUTE FUNCTION "prevent_admin_audit_event_mutation"();
