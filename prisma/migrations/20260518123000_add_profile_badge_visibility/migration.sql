ALTER TABLE "users"
  ADD COLUMN "hidden_profile_badge_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
