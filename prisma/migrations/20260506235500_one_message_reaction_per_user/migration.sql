WITH ranked_reactions AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY message_id, user_id
      ORDER BY created_at DESC, id DESC
    ) AS reaction_rank
  FROM message_reactions
)
DELETE FROM message_reactions
WHERE id IN (
  SELECT id
  FROM ranked_reactions
  WHERE reaction_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_message_id_user_id_key"
ON "message_reactions"("message_id", "user_id");
