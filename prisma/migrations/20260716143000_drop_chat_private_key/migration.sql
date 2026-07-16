-- Private chat key material must never be stored by the server.
ALTER TABLE "users" DROP COLUMN "chat_private_key";
