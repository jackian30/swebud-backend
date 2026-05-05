CREATE TYPE "post_visibility" AS ENUM ('public', 'followers', 'mutuals', 'close_buddies');
CREATE TYPE "profile_visibility" AS ENUM ('public', 'followers', 'mutuals', 'close_buddies', 'private');
CREATE TYPE "integration_provider" AS ENUM ('strava', 'garmin');
CREATE TYPE "integration_status" AS ENUM ('connected', 'disconnected', 'revoked', 'error');
CREATE TYPE "activity_source" AS ENUM ('manual', 'strava', 'garmin');

ALTER TABLE "users" ADD COLUMN "profile_visibility" "profile_visibility" NOT NULL DEFAULT 'public';

CREATE TABLE "close_buddies" (
  "owner_id" TEXT NOT NULL,
  "buddy_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "close_buddies_pkey" PRIMARY KEY ("owner_id", "buddy_id")
);

CREATE TABLE "external_integrations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" "integration_provider" NOT NULL,
  "provider_user_id" TEXT,
  "status" "integration_status" NOT NULL DEFAULT 'connected',
  "access_token_hash" TEXT,
  "refresh_token_hash" TEXT,
  "token_expires_at" TIMESTAMP(3),
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "last_sync_at" TIMESTAMP(3),
  "last_sync_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "external_integrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "activities" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "integration_id" TEXT,
  "source" "activity_source" NOT NULL DEFAULT 'manual',
  "external_id" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL,
  "duration_seconds" INTEGER,
  "distance_meters" DOUBLE PRECISION,
  "elevation_gain_meters" DOUBLE PRECISION,
  "calories" INTEGER,
  "average_heart_rate" INTEGER,
  "max_heart_rate" INTEGER,
  "average_pace_seconds_km" INTEGER,
  "average_speed_meters_sec" DOUBLE PRECISION,
  "raw" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "posts" ADD COLUMN "visibility" "post_visibility" NOT NULL DEFAULT 'public', ADD COLUMN "activity_id" TEXT;

CREATE INDEX "close_buddies_buddy_id_idx" ON "close_buddies"("buddy_id");
CREATE UNIQUE INDEX "external_integrations_user_id_provider_key" ON "external_integrations"("user_id", "provider");
CREATE INDEX "external_integrations_provider_provider_user_id_idx" ON "external_integrations"("provider", "provider_user_id");
CREATE INDEX "external_integrations_user_id_status_idx" ON "external_integrations"("user_id", "status");
CREATE UNIQUE INDEX "activities_source_external_id_user_id_key" ON "activities"("source", "external_id", "user_id");
CREATE INDEX "activities_user_id_started_at_idx" ON "activities"("user_id", "started_at");
CREATE INDEX "activities_type_started_at_idx" ON "activities"("type", "started_at");
CREATE INDEX "posts_activity_id_idx" ON "posts"("activity_id");
CREATE INDEX "posts_visibility_created_at_idx" ON "posts"("visibility", "created_at");

ALTER TABLE "close_buddies" ADD CONSTRAINT "close_buddies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "close_buddies" ADD CONSTRAINT "close_buddies_buddy_id_fkey" FOREIGN KEY ("buddy_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_integrations" ADD CONSTRAINT "external_integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activities" ADD CONSTRAINT "activities_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "external_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "posts" ADD CONSTRAINT "posts_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
