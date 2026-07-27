\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'

SELECT
  current_database(),
  current_setting('server_version_num'),
  (SELECT count(*) FROM public."_prisma_migrations"),
  (SELECT count(*) FROM public."users"),
  (SELECT count(*) FROM public."posts"),
  (SELECT count(*) FROM public."groups");
