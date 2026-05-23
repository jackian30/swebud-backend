DELETE FROM "user_badges"
USING "badges"
WHERE "user_badges"."badge_id" = "badges"."id"
  AND "badges"."code" = 'app_creator';

DELETE FROM "badges"
WHERE "code" = 'app_creator';
