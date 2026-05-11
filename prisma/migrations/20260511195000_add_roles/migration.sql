CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_roles" (
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "roles" ("id", "key", "name", "description")
VALUES
  ('role-admin', 'admin', 'Admin', 'Full administrative access.'),
  ('role-user', 'user', 'Users', 'Default application user access.')
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "user_roles" ("user_id", "role_id")
SELECT "id", 'role-user' FROM "users"
ON CONFLICT DO NOTHING;

INSERT INTO "user_roles" ("user_id", "role_id")
SELECT "id", 'role-admin' FROM "users" WHERE COALESCE("is_admin", false) = true
ON CONFLICT DO NOTHING;

DROP INDEX IF EXISTS "users_is_admin_idx";
ALTER TABLE "users" DROP COLUMN IF EXISTS "is_admin";
