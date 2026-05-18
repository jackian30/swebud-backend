CREATE TABLE "badges" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "icon_url" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_badges" (
  "user_id" TEXT NOT NULL,
  "badge_id" TEXT NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assigned_by" TEXT,
  "note" TEXT,

  CONSTRAINT "user_badges_pkey" PRIMARY KEY ("user_id", "badge_id")
);

CREATE UNIQUE INDEX "badges_code_key" ON "badges"("code");
CREATE INDEX "badges_active_sort_order_idx" ON "badges"("active", "sort_order");
CREATE INDEX "user_badges_badge_id_idx" ON "user_badges"("badge_id");
CREATE INDEX "user_badges_user_id_assigned_at_idx" ON "user_badges"("user_id", "assigned_at");

ALTER TABLE "user_badges"
  ADD CONSTRAINT "user_badges_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_badges"
  ADD CONSTRAINT "user_badges_badge_id_fkey"
  FOREIGN KEY ("badge_id") REFERENCES "badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "badges" ("id", "code", "label", "description", "icon_url", "sort_order")
VALUES
  ('badge_beta_user', 'beta_user', 'Beta User', 'Early SweBudd beta user', '/icons/profile-badges/beta-user.svg', 10),
  ('badge_app_creator', 'app_creator', 'App Creator', 'Creator of SweBudd', '/icons/profile-badges/app-creator.svg', 1)
ON CONFLICT ("code") DO UPDATE
SET
  "label" = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "icon_url" = EXCLUDED."icon_url",
  "sort_order" = EXCLUDED."sort_order",
  "active" = true,
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "user_badges" ("user_id", "badge_id", "note")
SELECT "id", 'badge_beta_user', 'Backfilled from users.beta_user'
FROM "users"
WHERE "beta_user" = true
ON CONFLICT DO NOTHING;

INSERT INTO "user_badges" ("user_id", "badge_id", "note")
SELECT "id", 'badge_app_creator', 'Initial creator assignment'
FROM "users"
WHERE lower("username") IN ('christopherian30cir', 'tophers')
   OR lower("email") IN ('christopher.ian30.cir@gmail.com')
ON CONFLICT DO NOTHING;
