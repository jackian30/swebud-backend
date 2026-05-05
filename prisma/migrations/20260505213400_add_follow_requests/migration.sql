CREATE TYPE "follow_request_status" AS ENUM ('pending', 'accepted', 'declined');

ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'follow_request';

CREATE TABLE "follow_requests" (
    "id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "status" "follow_request_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "follow_requests_requester_id_recipient_id_key" ON "follow_requests"("requester_id", "recipient_id");
CREATE INDEX "follow_requests_recipient_id_status_created_at_idx" ON "follow_requests"("recipient_id", "status", "created_at");
CREATE INDEX "follow_requests_requester_id_status_created_at_idx" ON "follow_requests"("requester_id", "status", "created_at");

ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
