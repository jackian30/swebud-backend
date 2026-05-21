CREATE TYPE "map_visual_preference" AS ENUM ('system', 'streets', 'light', 'dark', 'satellite');

ALTER TABLE "user_themes"
ADD COLUMN "map_visual" "map_visual_preference" NOT NULL DEFAULT 'streets';
