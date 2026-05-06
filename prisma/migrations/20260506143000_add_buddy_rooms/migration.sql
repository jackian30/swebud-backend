-- CreateEnum
CREATE TYPE "buddy_session_scope" AS ENUM ('public', 'group');

-- CreateEnum
CREATE TYPE "buddy_session_visibility" AS ENUM ('public', 'private');

-- AlterTable
ALTER TABLE "buddy_sessions" ADD COLUMN "room_id" TEXT;

-- CreateTable
CREATE TABLE "buddy_rooms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "buddy_session_scope" NOT NULL DEFAULT 'public',
    "visibility" "buddy_session_visibility" NOT NULL DEFAULT 'public',
    "code" TEXT NOT NULL,
    "group_id" TEXT,
    "creator_id" TEXT NOT NULL,
    "activity" "buddy_activity",
    "sub_activity" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buddy_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buddy_rooms_code_key" ON "buddy_rooms"("code");

-- CreateIndex
CREATE INDEX "buddy_rooms_scope_visibility_expires_at_idx" ON "buddy_rooms"("scope", "visibility", "expires_at");

-- CreateIndex
CREATE INDEX "buddy_rooms_group_id_expires_at_idx" ON "buddy_rooms"("group_id", "expires_at");

-- CreateIndex
CREATE INDEX "buddy_sessions_room_id_expires_at_idx" ON "buddy_sessions"("room_id", "expires_at");

-- AddForeignKey
ALTER TABLE "buddy_sessions" ADD CONSTRAINT "buddy_sessions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "buddy_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_rooms" ADD CONSTRAINT "buddy_rooms_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_rooms" ADD CONSTRAINT "buddy_rooms_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
