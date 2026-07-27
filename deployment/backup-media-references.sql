\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- This query runs only after the application has been quiesced. Completed
-- quarantine objects can be the only recoverable copy while work is
-- completing, queued, or processing. Ready/failed terminal rows are included
-- until their quarantine deletion is durably recorded. Public assets and
-- uncleaned publish attempts can likewise point at a staged or winning object.
--
-- Creating/uploading sessions are multipart state, not list-objects-visible
-- objects. Their parts are intentionally not treated as backup payload, but
-- their persisted bucket is retained so bucket rotation fails closed until
-- those sessions have been drained, cancelled, or cleaned up.
WITH quarantine_references AS (
  SELECT DISTINCT
    quarantine_bucket AS bucket,
    quarantine_key AS key
  FROM public.media_upload_sessions
  WHERE quarantine_deleted_at IS NULL
    AND status::text IN (
      'completing',
      'queued',
      'processing',
      'ready',
      'rejected',
      'failed'
    )
),
public_references AS (
  SELECT DISTINCT
    public_bucket AS bucket,
    public_key AS key
  FROM public.media_assets
  WHERE status::text = 'ready'
    AND public_bucket IS NOT NULL
    AND public_key IS NOT NULL

  UNION

  SELECT DISTINCT
    public_bucket AS bucket,
    public_key AS key
  FROM public.media_publish_attempts
  WHERE cleaned_at IS NULL
    AND status::text IN (
      'staged',
      'published',
      'winner',
      'cleanup_pending'
    )
),
unfinished_multipart AS (
  SELECT
    quarantine_bucket AS bucket,
    count(*)::bigint AS session_count
  FROM public.media_upload_sessions
  WHERE status::text IN ('creating', 'uploading')
  GROUP BY quarantine_bucket
)
SELECT jsonb_build_object(
  'format', 'swebudd-media-backup-references-v1',
  'public', COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object('bucket', bucket, 'key', key)
        ORDER BY bucket, key
      )
      FROM public_references
    ),
    '[]'::jsonb
  ),
  'quarantine', COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object('bucket', bucket, 'key', key)
        ORDER BY bucket, key
      )
      FROM quarantine_references
    ),
    '[]'::jsonb
  ),
  'unfinishedMultipart', COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object('bucket', bucket, 'sessionCount', session_count)
        ORDER BY bucket
      )
      FROM unfinished_multipart
    ),
    '[]'::jsonb
  )
)::text;
