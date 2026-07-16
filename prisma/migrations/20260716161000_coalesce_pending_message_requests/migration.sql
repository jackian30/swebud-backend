-- A pair of users may have only one pending message request, regardless of
-- which side submitted it. Accepted/declined history remains intact.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY LEAST("sender_id", "recipient_id"), GREATEST("sender_id", "recipient_id")
    ORDER BY "created_at" ASC, "id" ASC
  ) AS position
  FROM "message_requests"
  WHERE "status" = 'pending'::"message_request_status"
)
UPDATE "message_requests" AS request
SET "status" = 'declined'::"message_request_status", "updated_at" = NOW()
FROM ranked
WHERE request."id" = ranked."id" AND ranked.position > 1;

CREATE UNIQUE INDEX "message_requests_one_pending_pair_key"
ON "message_requests" (
  LEAST("sender_id", "recipient_id"),
  GREATEST("sender_id", "recipient_id")
)
WHERE "status" = 'pending'::"message_request_status";
