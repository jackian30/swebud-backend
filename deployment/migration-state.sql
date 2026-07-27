\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'

SELECT
  count(*),
  md5(
    coalesce(
      string_agg(
        migration_name || ':' || checksum || ':' || finished_at::text,
        E'\n' ORDER BY migration_name
      ),
      ''
    )
  )
FROM public."_prisma_migrations"
WHERE finished_at IS NOT NULL;
