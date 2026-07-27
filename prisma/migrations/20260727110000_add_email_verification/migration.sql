ALTER TABLE "users"
  ADD COLUMN "email_verified_at" TIMESTAMP(3),
  ADD COLUMN "email_verification_sent_at" TIMESTAMP(3);

-- Google has already vouched for these addresses. Local/password accounts must
-- prove control of their address through the new single-use token flow.
UPDATE "users"
SET "email_verified_at" = COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP)
WHERE "google_email_verified" = true;

CREATE TABLE "email_verification_tokens" (
  "id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_verification_tokens_user_id_idx"
  ON "email_verification_tokens"("user_id");
CREATE INDEX "email_verification_tokens_user_id_used_at_expires_at_idx"
  ON "email_verification_tokens"("user_id", "used_at", "expires_at");

ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
