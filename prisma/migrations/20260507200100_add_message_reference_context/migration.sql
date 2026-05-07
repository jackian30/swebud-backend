ALTER TABLE "message_requests"
ADD COLUMN "reference_type" TEXT,
ADD COLUMN "reference_id" TEXT,
ADD COLUMN "reference_media_url" TEXT,
ADD COLUMN "reference_text" TEXT,
ADD COLUMN "reference_author_name" TEXT;

ALTER TABLE "messages"
ADD COLUMN "reference_type" TEXT,
ADD COLUMN "reference_id" TEXT,
ADD COLUMN "reference_media_url" TEXT,
ADD COLUMN "reference_text" TEXT,
ADD COLUMN "reference_author_name" TEXT;
