CREATE TYPE "group_report_reason" AS ENUM ('spam', 'harassment', 'nudity', 'violence', 'other');
CREATE TYPE "report_category" AS ENUM ('spam', 'harassment', 'hate', 'sexual_content', 'violence', 'self_harm', 'scam', 'privacy', 'impersonation', 'illegal_activity', 'other');
CREATE TYPE "report_status" AS ENUM ('open', 'reviewing', 'resolved', 'dismissed');
CREATE TYPE "user_moderation_status" AS ENUM ('active', 'banned');

ALTER TABLE "users"
  ADD COLUMN "moderation_status" "user_moderation_status" NOT NULL DEFAULT 'active',
  ADD COLUMN "banned_at" TIMESTAMP(3),
  ADD COLUMN "banned_until" TIMESTAMP(3),
  ADD COLUMN "ban_reason" TEXT;

ALTER TABLE "post_reports"
  ADD COLUMN "category" "report_category" NOT NULL DEFAULT 'other',
  ADD COLUMN "details" TEXT,
  ADD COLUMN "status" "report_status" NOT NULL DEFAULT 'open',
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by_id" TEXT,
  ADD COLUMN "action_taken" TEXT,
  ADD COLUMN "resolution_note" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "user_reports"
  ADD COLUMN "category" "report_category" NOT NULL DEFAULT 'other',
  ADD COLUMN "details" TEXT,
  ADD COLUMN "status" "report_status" NOT NULL DEFAULT 'open',
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by_id" TEXT,
  ADD COLUMN "action_taken" TEXT,
  ADD COLUMN "resolution_note" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "post_reports" SET "category" = CASE
  WHEN "reason" = 'spam' THEN 'spam'::"report_category"
  WHEN "reason" = 'harassment' THEN 'harassment'::"report_category"
  WHEN "reason" = 'nudity' THEN 'sexual_content'::"report_category"
  WHEN "reason" = 'violence' THEN 'violence'::"report_category"
  ELSE 'other'::"report_category"
END;

UPDATE "user_reports" SET "category" = CASE
  WHEN "reason" = 'spam' THEN 'spam'::"report_category"
  WHEN "reason" = 'harassment' THEN 'harassment'::"report_category"
  WHEN "reason" = 'nudity' THEN 'sexual_content'::"report_category"
  WHEN "reason" = 'violence' THEN 'violence'::"report_category"
  ELSE 'other'::"report_category"
END;

CREATE TABLE "group_reports" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "reason" "group_report_reason" NOT NULL DEFAULT 'other',
  "category" "report_category" NOT NULL DEFAULT 'other',
  "note" TEXT,
  "details" TEXT,
  "status" "report_status" NOT NULL DEFAULT 'open',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "reviewed_at" TIMESTAMP(3),
  "reviewed_by_id" TEXT,
  "action_taken" TEXT,
  "resolution_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "group_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "group_reports_group_id_user_id_key" ON "group_reports"("group_id", "user_id");
CREATE INDEX "group_reports_status_category_created_at_idx" ON "group_reports"("status", "category", "created_at");
CREATE INDEX "group_reports_group_id_created_at_idx" ON "group_reports"("group_id", "created_at");
CREATE INDEX "group_reports_user_id_created_at_idx" ON "group_reports"("user_id", "created_at");
CREATE INDEX "post_reports_status_category_created_at_idx" ON "post_reports"("status", "category", "created_at");
CREATE INDEX "user_reports_status_category_created_at_idx" ON "user_reports"("status", "category", "created_at");
CREATE INDEX "users_moderation_status_banned_until_idx" ON "users"("moderation_status", "banned_until");

ALTER TABLE "group_reports" ADD CONSTRAINT "group_reports_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_reports" ADD CONSTRAINT "group_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
