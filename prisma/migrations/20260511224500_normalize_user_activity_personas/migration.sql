-- Normalize users.activity_persona and users.activity_personas[] into a join table.
CREATE TABLE "user_activity_personas" (
    "user_id" TEXT NOT NULL,
    "persona" "activity_persona" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_activity_personas_pkey" PRIMARY KEY ("user_id","persona")
);

INSERT INTO "user_activity_personas" ("user_id", "persona", "sort_order")
SELECT "id", "persona", MIN("sort_order") AS "sort_order"
FROM (
    SELECT
        "id",
        "activity_persona" AS "persona",
        0 AS "sort_order"
    FROM "users"
    WHERE "activity_persona" IS NOT NULL

    UNION ALL

    SELECT
        "users"."id",
        "items"."persona",
        "items"."sort_order"
    FROM "users"
    CROSS JOIN LATERAL unnest("users"."activity_personas") WITH ORDINALITY AS "items"("persona", "sort_order")
    WHERE "users"."activity_personas" IS NOT NULL
) AS "normalized"
WHERE "persona" IS NOT NULL
GROUP BY "id", "persona";

CREATE INDEX "user_activity_personas_persona_idx" ON "user_activity_personas"("persona");
CREATE INDEX "user_activity_personas_user_id_sort_order_idx" ON "user_activity_personas"("user_id", "sort_order");

ALTER TABLE "user_activity_personas"
ADD CONSTRAINT "user_activity_personas_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "users_activity_persona_idx";
ALTER TABLE "users" DROP COLUMN IF EXISTS "activity_persona";
ALTER TABLE "users" DROP COLUMN IF EXISTS "activity_personas";
