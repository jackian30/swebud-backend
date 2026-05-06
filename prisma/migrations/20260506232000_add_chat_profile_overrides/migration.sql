CREATE TABLE "chat_profile_overrides" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "peer_id" TEXT NOT NULL,
  "display_name" TEXT,
  "profile_image_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "chat_profile_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_profile_overrides_owner_id_peer_id_key" ON "chat_profile_overrides"("owner_id", "peer_id");
CREATE INDEX "chat_profile_overrides_peer_id_idx" ON "chat_profile_overrides"("peer_id");

ALTER TABLE "chat_profile_overrides" ADD CONSTRAINT "chat_profile_overrides_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_profile_overrides" ADD CONSTRAINT "chat_profile_overrides_peer_id_fkey" FOREIGN KEY ("peer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
