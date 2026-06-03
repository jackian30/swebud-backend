CREATE TABLE "login_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "device_label" TEXT,
  "location_label" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,

  CONSTRAINT "login_sessions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "refresh_tokens" ADD COLUMN "login_session_id" TEXT;

INSERT INTO "login_sessions" ("id", "user_id", "expires_at", "revoked_at", "created_at", "updated_at")
SELECT "id", "user_id", "expires_at", "revoked_at", "created_at", CURRENT_TIMESTAMP
FROM "refresh_tokens"
WHERE "revoked_at" IS NULL AND "expires_at" > CURRENT_TIMESTAMP;

UPDATE "refresh_tokens"
SET "login_session_id" = "id"
WHERE "revoked_at" IS NULL AND "expires_at" > CURRENT_TIMESTAMP;

CREATE INDEX "login_sessions_user_id_idx" ON "login_sessions"("user_id");
CREATE INDEX "login_sessions_user_id_revoked_at_expires_at_idx" ON "login_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "refresh_tokens_login_session_id_idx" ON "refresh_tokens"("login_session_id");

ALTER TABLE "login_sessions"
  ADD CONSTRAINT "login_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_login_session_id_fkey"
  FOREIGN KEY ("login_session_id") REFERENCES "login_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
