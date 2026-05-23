UPDATE "users"
SET "hidden_profile_badge_codes" = array_remove("hidden_profile_badge_codes", 'app_creator')
WHERE 'app_creator' = ANY("hidden_profile_badge_codes");
