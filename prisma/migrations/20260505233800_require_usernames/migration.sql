UPDATE "users"
SET "username" = lower(regexp_replace(split_part("email", '@', 1), '[^a-zA-Z0-9_]', '', 'g')) || substr(md5("id"), 1, 6)
WHERE "username" IS NULL OR btrim("username") = '';

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;
