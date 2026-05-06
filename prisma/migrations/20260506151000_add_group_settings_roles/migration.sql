-- AlterEnum
ALTER TYPE "group_role" ADD VALUE IF NOT EXISTS 'moderator';

-- AlterTable
ALTER TABLE "groups" ADD COLUMN "allow_anonymous_posts" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN "is_anonymous" BOOLEAN NOT NULL DEFAULT false;
