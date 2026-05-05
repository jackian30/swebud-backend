ALTER TABLE "users" ADD COLUMN "username_finalized" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "activity_personas" "activity_persona"[] NOT NULL DEFAULT ARRAY[]::"activity_persona"[];
ALTER TABLE "users" ADD COLUMN "google_id" TEXT;
ALTER TABLE "users" ADD COLUMN "google_email_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "legal_consent_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "data_consent_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");
