ALTER TABLE "users" ADD COLUMN "beta_user" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "hide_profile_badges" BOOLEAN NOT NULL DEFAULT false;

WITH first_beta_users AS (
  SELECT "id"
  FROM "users"
  ORDER BY "created_at" ASC, "id" ASC
  LIMIT 300
)
UPDATE "users"
SET "beta_user" = true
WHERE "id" IN (SELECT "id" FROM first_beta_users);
