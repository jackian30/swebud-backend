CREATE TABLE "post_tagged_users" (
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_tagged_users_pkey" PRIMARY KEY ("post_id", "user_id")
);

CREATE INDEX "post_tagged_users_user_id_created_at_idx" ON "post_tagged_users"("user_id", "created_at");

ALTER TABLE "post_tagged_users" ADD CONSTRAINT "post_tagged_users_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_tagged_users" ADD CONSTRAINT "post_tagged_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
