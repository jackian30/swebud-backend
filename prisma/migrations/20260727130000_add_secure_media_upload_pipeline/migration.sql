CREATE TYPE "media_upload_session_status" AS ENUM (
  'creating',
  'uploading',
  'completing',
  'queued',
  'processing',
  'ready',
  'rejected',
  'failed',
  'cancelled',
  'expired'
);

CREATE TYPE "media_asset_status" AS ENUM (
  'quarantined',
  'processing',
  'ready',
  'rejected'
);

CREATE TYPE "media_processing_job_status" AS ENUM (
  'pending',
  'leased',
  'retry_wait',
  'succeeded',
  'dead_letter',
  'cancelled'
);

CREATE TYPE "media_publish_attempt_status" AS ENUM (
  'staged',
  'published',
  'winner',
  'cleanup_pending',
  'cleaned'
);

CREATE TABLE "media_upload_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "idempotency_key" TEXT,
  "collection" TEXT NOT NULL,
  "declared_mime_type" TEXT NOT NULL,
  "declared_size" INTEGER NOT NULL,
  "declared_sha256" TEXT,
  "quarantine_bucket" TEXT NOT NULL,
  "quarantine_key" TEXT NOT NULL,
  "provider_upload_id" TEXT,
  "checksum_algorithm" TEXT NOT NULL DEFAULT 'SHA256',
  "part_size" INTEGER NOT NULL,
  "expected_part_count" INTEGER NOT NULL,
  "status" "media_upload_session_status" NOT NULL DEFAULT 'creating',
  "completion_claim_id" UUID,
  "object_etag" TEXT,
  "object_checksum_sha256" TEXT,
  "failure_code" TEXT,
  "failure_message" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "quarantine_cleanup_started_at" TIMESTAMP(3),
  "quarantine_deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_upload_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "media_upload_parts" (
  "session_id" UUID NOT NULL,
  "part_number" INTEGER NOT NULL,
  "etag" TEXT NOT NULL,
  "checksum_sha256" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_upload_parts_pkey" PRIMARY KEY ("session_id", "part_number")
);

CREATE TABLE "media_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "collection" TEXT NOT NULL,
  "status" "media_asset_status" NOT NULL DEFAULT 'quarantined',
  "mime_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "sha256" TEXT,
  "public_bucket" TEXT,
  "public_key" TEXT,
  "public_url" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "duration_seconds" DOUBLE PRECISION,
  "failure_code" TEXT,
  "failure_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "media_processing_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "status" "media_processing_job_status" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" TEXT,
  "leased_at" TIMESTAMP(3),
  "lease_expires_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_processing_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "media_publish_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "worker_id" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "public_bucket" TEXT NOT NULL,
  "public_key" TEXT NOT NULL,
  "status" "media_publish_attempt_status" NOT NULL DEFAULT 'staged',
  "last_error" TEXT,
  "published_at" TIMESTAMP(3),
  "finalized_at" TIMESTAMP(3),
  "cleaned_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_publish_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_upload_sessions_user_id_idempotency_key_key"
  ON "media_upload_sessions"("user_id", "idempotency_key");
CREATE UNIQUE INDEX "media_upload_sessions_quarantine_bucket_quarantine_key_key"
  ON "media_upload_sessions"("quarantine_bucket", "quarantine_key");
CREATE INDEX "media_upload_sessions_user_id_status_created_at_idx"
  ON "media_upload_sessions"("user_id", "status", "created_at");
CREATE INDEX "media_upload_sessions_status_expires_at_idx"
  ON "media_upload_sessions"("status", "expires_at");
CREATE INDEX "media_upload_sessions_created_at_idx"
  ON "media_upload_sessions"("created_at");

CREATE INDEX "media_upload_parts_session_id_created_at_idx"
  ON "media_upload_parts"("session_id", "created_at");

CREATE UNIQUE INDEX "media_assets_session_id_key" ON "media_assets"("session_id");
CREATE UNIQUE INDEX "media_assets_public_key_key" ON "media_assets"("public_key");
CREATE INDEX "media_assets_user_id_status_created_at_idx"
  ON "media_assets"("user_id", "status", "created_at");
CREATE INDEX "media_assets_status_created_at_idx"
  ON "media_assets"("status", "created_at");

CREATE UNIQUE INDEX "media_processing_jobs_session_id_key"
  ON "media_processing_jobs"("session_id");
CREATE INDEX "media_processing_jobs_status_available_at_created_at_idx"
  ON "media_processing_jobs"("status", "available_at", "created_at");
CREATE INDEX "media_processing_jobs_status_lease_expires_at_idx"
  ON "media_processing_jobs"("status", "lease_expires_at");

CREATE UNIQUE INDEX "media_publish_attempts_public_key_key"
  ON "media_publish_attempts"("public_key");
CREATE INDEX "media_publish_attempts_session_id_status_created_at_idx"
  ON "media_publish_attempts"("session_id", "status", "created_at");
CREATE INDEX "media_publish_attempts_job_id_status_idx"
  ON "media_publish_attempts"("job_id", "status");
CREATE INDEX "media_publish_attempts_status_created_at_idx"
  ON "media_publish_attempts"("status", "created_at");

ALTER TABLE "media_upload_sessions"
  ADD CONSTRAINT "media_upload_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_upload_parts"
  ADD CONSTRAINT "media_upload_parts_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "media_upload_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "media_upload_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_processing_jobs"
  ADD CONSTRAINT "media_processing_jobs_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "media_upload_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
