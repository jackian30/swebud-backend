CREATE TYPE "user_report_reason" AS ENUM ('spam', 'harassment', 'nudity', 'violence', 'other');

CREATE TABLE "user_reports" (
    "id" TEXT NOT NULL,
    "reported_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reason" "user_report_reason" NOT NULL DEFAULT 'other',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_reports_reported_id_reporter_id_key" ON "user_reports"("reported_id", "reporter_id");
CREATE INDEX "user_reports_reported_id_created_at_idx" ON "user_reports"("reported_id", "created_at");
CREATE INDEX "user_reports_reporter_id_created_at_idx" ON "user_reports"("reporter_id", "created_at");

ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_reported_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
