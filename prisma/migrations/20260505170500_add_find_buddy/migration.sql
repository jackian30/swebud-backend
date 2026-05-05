-- CreateEnum
CREATE TYPE "user_gender" AS ENUM ('female', 'male', 'non_binary', 'prefer_not_to_say', 'other');

-- CreateEnum
CREATE TYPE "activity_persona" AS ENUM ('runner', 'bodybuilder', 'cyclist', 'yogi', 'swimmer', 'powerlifter', 'crossfitter', 'walker', 'other');

-- CreateEnum
CREATE TYPE "buddy_activity" AS ENUM ('running', 'gym', 'cycling', 'yoga', 'walking', 'swimming', 'sports', 'other');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "activity_persona" "activity_persona",
ADD COLUMN     "date_of_birth" TIMESTAMP(3),
ADD COLUMN     "gender" "user_gender";

-- CreateTable
CREATE TABLE "buddy_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "activity" "buddy_activity" NOT NULL,
    "sub_activity" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buddy_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buddy_sessions_user_id_key" ON "buddy_sessions"("user_id");

-- CreateIndex
CREATE INDEX "buddy_sessions_activity_expires_at_idx" ON "buddy_sessions"("activity", "expires_at");

-- CreateIndex
CREATE INDEX "buddy_sessions_latitude_longitude_idx" ON "buddy_sessions"("latitude", "longitude");

-- AddForeignKey
ALTER TABLE "buddy_sessions" ADD CONSTRAINT "buddy_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
