ALTER TABLE "users" ADD COLUMN "is_admin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users"
SET "is_admin" = true
WHERE lower("email") = 'christopher.ian30.cir@gmail.com';
