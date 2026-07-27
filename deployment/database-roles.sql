\set ON_ERROR_STOP on

\getenv runtime_role DATABASE_RUNTIME_USER
\getenv runtime_password DATABASE_RUNTIME_PASSWORD
\getenv readonly_role DATABASE_ADMIN_READONLY_USER
\getenv readonly_password DATABASE_ADMIN_READONLY_PASSWORD
\getenv backup_role DATABASE_BACKUP_USER
\getenv backup_password DATABASE_BACKUP_PASSWORD

BEGIN;

-- Serialize role reconciliation per database. The lock is transaction-scoped,
-- so every role/ACL/default-ACL change below either commits together or rolls
-- back together.
SELECT pg_advisory_xact_lock(
  hashtext(current_database()),
  hashtext('swebudd-database-role-provisioning-v1')
);

CREATE TEMPORARY TABLE expected_database_roles (
  role_kind text PRIMARY KEY,
  role_name name NOT NULL UNIQUE,
  role_password text NOT NULL
) ON COMMIT DROP;

INSERT INTO expected_database_roles (role_kind, role_name, role_password)
VALUES
  ('runtime', :'runtime_role', :'runtime_password'),
  ('readonly', :'readonly_role', :'readonly_password'),
  ('backup', :'backup_role', :'backup_password');

DO $guard$
DECLARE
  owner_role name := current_user;
  bad_memberships text;
  bad_ownership text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM expected_database_roles
    WHERE role_name = owner_role
  ) THEN
    RAISE EXCEPTION
      'Migration owner % must be separate from every application role',
      owner_role;
  END IF;

  SELECT string_agg(
    format('%I -> %I', member_role.rolname, granted_role.rolname),
    ', ' ORDER BY member_role.rolname, granted_role.rolname
  )
  INTO bad_memberships
  FROM pg_auth_members AS membership
  JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
  JOIN pg_roles AS member_role ON member_role.oid = membership.member
  WHERE granted_role.rolname IN (
      SELECT role_name FROM expected_database_roles
    )
     OR member_role.rolname IN (
      SELECT role_name FROM expected_database_roles
    );

  IF bad_memberships IS NOT NULL THEN
    RAISE EXCEPTION
      'Application database roles must not participate in role memberships: %',
      bad_memberships;
  END IF;

  WITH protected_roles AS (
    SELECT roles.oid, roles.rolname
    FROM pg_roles AS roles
    JOIN expected_database_roles AS expected
      ON expected.role_name = roles.rolname
  ),
  owned_objects AS (
    SELECT protected.rolname, 'database ' || quote_ident(database.datname) AS object_name
    FROM pg_database AS database
    JOIN protected_roles AS protected ON protected.oid = database.datdba

    UNION ALL

    SELECT protected.rolname, 'schema ' || quote_ident(namespace.nspname)
    FROM pg_namespace AS namespace
    JOIN protected_roles AS protected ON protected.oid = namespace.nspowner

    UNION ALL

    SELECT
      protected.rolname,
      'relation ' || quote_ident(namespace.nspname) || '.' || quote_ident(relation.relname)
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN protected_roles AS protected ON protected.oid = relation.relowner

    UNION ALL

    SELECT
      protected.rolname,
      'routine ' || quote_ident(namespace.nspname) || '.' || quote_ident(routine.proname)
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    JOIN protected_roles AS protected ON protected.oid = routine.proowner

    UNION ALL

    SELECT
      protected.rolname,
      'type ' || quote_ident(namespace.nspname) || '.' || quote_ident(type.typname)
    FROM pg_type AS type
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    JOIN protected_roles AS protected ON protected.oid = type.typowner

    UNION ALL

    SELECT
      protected.rolname,
      'collation ' || quote_ident(namespace.nspname) || '.' || quote_ident(collation.collname)
    FROM pg_collation AS collation
    JOIN pg_namespace AS namespace ON namespace.oid = collation.collnamespace
    JOIN protected_roles AS protected ON protected.oid = collation.collowner

    UNION ALL

    SELECT
      protected.rolname,
      'text search configuration ' || quote_ident(namespace.nspname) || '.' ||
        quote_ident(configuration.cfgname)
    FROM pg_ts_config AS configuration
    JOIN pg_namespace AS namespace ON namespace.oid = configuration.cfgnamespace
    JOIN protected_roles AS protected ON protected.oid = configuration.cfgowner

    UNION ALL

    SELECT
      protected.rolname,
      'text search dictionary ' || quote_ident(namespace.nspname) || '.' ||
        quote_ident(dictionary.dictname)
    FROM pg_ts_dict AS dictionary
    JOIN pg_namespace AS namespace ON namespace.oid = dictionary.dictnamespace
    JOIN protected_roles AS protected ON protected.oid = dictionary.dictowner
  )
  SELECT string_agg(
    format('%I owns %s', rolname, object_name),
    ', ' ORDER BY rolname, object_name
  )
  INTO bad_ownership
  FROM owned_objects;

  IF bad_ownership IS NOT NULL THEN
    RAISE EXCEPTION
      'Application database roles must not own database objects: %',
      bad_ownership;
  END IF;
END
$guard$;

SELECT format('CREATE ROLE %I', role_name)
FROM expected_database_roles AS expected
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = expected.role_name
)
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 VALID UNTIL %L',
  role_name,
  role_password,
  'infinity'
)
FROM expected_database_roles
\gexec

-- Remove stale role-level and database-specific GUCs before applying the
-- intentionally small configuration below.
SELECT format('ALTER ROLE %I RESET ALL', role_name)
FROM expected_database_roles
\gexec

SELECT format(
  'ALTER ROLE %I IN DATABASE %I RESET ALL',
  role_name,
  current_database()
)
FROM expected_database_roles
\gexec

SELECT format(
  'ALTER ROLE %I IN DATABASE %I SET search_path = pg_catalog, public',
  role_name,
  current_database()
)
FROM expected_database_roles
\gexec

SELECT format(
  'ALTER ROLE %I IN DATABASE %I SET default_transaction_read_only = on',
  role_name,
  current_database()
)
FROM expected_database_roles
WHERE role_kind IN ('readonly', 'backup')
\gexec

-- A dedicated application database must not inherit database/schema/object
-- access through PUBLIC. The migration owner retains owner rights.
SELECT format(
  'REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC',
  current_database()
)
\gexec
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;

SELECT format(
  'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
  current_database(),
  role_name
)
FROM expected_database_roles
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I',
  role_name
)
FROM expected_database_roles
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
  role_name
)
FROM expected_database_roles
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
  role_name
)
FROM expected_database_roles
\gexec

SELECT format(
  'REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM %I',
  role_name
)
FROM expected_database_roles
\gexec

SELECT format(
  'GRANT CONNECT ON DATABASE %I TO %I',
  current_database(),
  role_name
)
FROM expected_database_roles
\gexec

SELECT format('GRANT USAGE ON SCHEMA public TO %I', role_name)
FROM expected_database_roles
\gexec

SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
  role_name
)
FROM expected_database_roles
WHERE role_kind = 'runtime'
\gexec

SELECT format(
  'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I',
  role_name
)
FROM expected_database_roles
WHERE role_kind = 'runtime'
\gexec

SELECT format(
  'GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I',
  role_name
)
FROM expected_database_roles
WHERE role_kind IN ('readonly', 'backup')
\gexec

-- pg_dump needs to read sequence state. The interactive read-only admin role
-- intentionally receives no sequence privilege.
SELECT format(
  'GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
  role_name
)
FROM expected_database_roles
WHERE role_kind = 'backup'
\gexec

-- Converge migration-owner default ACLs for future public-schema objects.
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC',
  current_user
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC',
  current_user
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM PUBLIC',
  current_user
)
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
  current_user,
  role_name
)
FROM expected_database_roles
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
  current_user,
  role_name
)
FROM expected_database_roles
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM %I',
  current_user,
  role_name
)
FROM expected_database_roles
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  current_user,
  role_name
)
FROM expected_database_roles
WHERE role_kind = 'runtime'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
  current_user,
  role_name
)
FROM expected_database_roles
WHERE role_kind = 'runtime'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I',
  current_user,
  role_name
)
FROM expected_database_roles
WHERE role_kind IN ('readonly', 'backup')
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON SEQUENCES TO %I',
  current_user,
  role_name
)
FROM expected_database_roles
WHERE role_kind = 'backup'
\gexec

DO $audit$
DECLARE
  expected record;
  role_attributes record;
  database_oid oid := (SELECT oid FROM pg_database WHERE datname = current_database());
BEGIN
  FOR expected IN
    SELECT role_kind, role_name
    FROM expected_database_roles
    ORDER BY role_kind
  LOOP
    SELECT
      rolcanlogin,
      rolsuper,
      rolinherit,
      rolcreaterole,
      rolcreatedb,
      rolreplication,
      rolbypassrls,
      rolconnlimit
    INTO STRICT role_attributes
    FROM pg_roles
    WHERE rolname = expected.role_name;

    IF role_attributes.rolcanlogin IS NOT TRUE
       OR role_attributes.rolsuper IS NOT FALSE
       OR role_attributes.rolinherit IS NOT FALSE
       OR role_attributes.rolcreaterole IS NOT FALSE
       OR role_attributes.rolcreatedb IS NOT FALSE
       OR role_attributes.rolreplication IS NOT FALSE
       OR role_attributes.rolbypassrls IS NOT FALSE
       OR role_attributes.rolconnlimit <> -1 THEN
      RAISE EXCEPTION 'Role % has unexpected attributes', expected.role_name;
    END IF;

    IF NOT has_database_privilege(expected.role_name, database_oid, 'CONNECT')
       OR has_database_privilege(expected.role_name, database_oid, 'CREATE')
       OR has_database_privilege(expected.role_name, database_oid, 'TEMPORARY') THEN
      RAISE EXCEPTION 'Role % has unexpected database privileges', expected.role_name;
    END IF;

    IF NOT has_schema_privilege(expected.role_name, 'public', 'USAGE')
       OR has_schema_privilege(expected.role_name, 'public', 'CREATE') THEN
      RAISE EXCEPTION 'Role % has unexpected public schema privileges', expected.role_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND (
          (
            expected.role_kind = 'runtime'
            AND (
              NOT has_table_privilege(expected.role_name, relation.oid, 'SELECT')
              OR NOT has_table_privilege(expected.role_name, relation.oid, 'INSERT')
              OR NOT has_table_privilege(expected.role_name, relation.oid, 'UPDATE')
              OR NOT has_table_privilege(expected.role_name, relation.oid, 'DELETE')
              OR has_table_privilege(expected.role_name, relation.oid, 'TRUNCATE')
              OR has_table_privilege(expected.role_name, relation.oid, 'REFERENCES')
              OR has_table_privilege(expected.role_name, relation.oid, 'TRIGGER')
            )
          )
          OR
          (
            expected.role_kind IN ('readonly', 'backup')
            AND (
              NOT has_table_privilege(expected.role_name, relation.oid, 'SELECT')
              OR has_table_privilege(expected.role_name, relation.oid, 'INSERT')
              OR has_table_privilege(expected.role_name, relation.oid, 'UPDATE')
              OR has_table_privilege(expected.role_name, relation.oid, 'DELETE')
              OR has_table_privilege(expected.role_name, relation.oid, 'TRUNCATE')
              OR has_table_privilege(expected.role_name, relation.oid, 'REFERENCES')
              OR has_table_privilege(expected.role_name, relation.oid, 'TRIGGER')
            )
          )
        )
    ) THEN
      RAISE EXCEPTION 'Role % has unexpected table privileges', expected.role_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_class AS sequence
      JOIN pg_namespace AS namespace ON namespace.oid = sequence.relnamespace
      WHERE namespace.nspname = 'public'
        AND sequence.relkind = 'S'
        AND (
          (
            expected.role_kind = 'runtime'
            AND (
              NOT has_sequence_privilege(expected.role_name, sequence.oid, 'USAGE')
              OR NOT has_sequence_privilege(expected.role_name, sequence.oid, 'SELECT')
              OR NOT has_sequence_privilege(expected.role_name, sequence.oid, 'UPDATE')
            )
          )
          OR
          (
            expected.role_kind = 'readonly'
            AND (
              has_sequence_privilege(expected.role_name, sequence.oid, 'USAGE')
              OR has_sequence_privilege(expected.role_name, sequence.oid, 'SELECT')
              OR has_sequence_privilege(expected.role_name, sequence.oid, 'UPDATE')
            )
          )
          OR
          (
            expected.role_kind = 'backup'
            AND (
              has_sequence_privilege(expected.role_name, sequence.oid, 'USAGE')
              OR NOT has_sequence_privilege(expected.role_name, sequence.oid, 'SELECT')
              OR has_sequence_privilege(expected.role_name, sequence.oid, 'UPDATE')
            )
          )
        )
    ) THEN
      RAISE EXCEPTION 'Role % has unexpected sequence privileges', expected.role_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_proc AS routine
      JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'public'
        AND has_function_privilege(expected.role_name, routine.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'Role % may unexpectedly execute public-schema routines', expected.role_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_db_role_setting AS settings
      JOIN pg_roles AS roles ON roles.oid = settings.setrole
      CROSS JOIN LATERAL unnest(settings.setconfig) AS setting
      WHERE roles.rolname = expected.role_name
        AND (
          settings.setdatabase <> database_oid
          OR split_part(setting, '=', 1) NOT IN (
            'search_path',
            'default_transaction_read_only'
          )
          OR (
            split_part(setting, '=', 1) = 'search_path'
            AND split_part(setting, '=', 2) <> 'pg_catalog, public'
          )
          OR (
            split_part(setting, '=', 1) = 'default_transaction_read_only'
            AND (
              expected.role_kind = 'runtime'
              OR split_part(setting, '=', 2) <> 'on'
            )
          )
        )
    ) THEN
      RAISE EXCEPTION 'Role % has unexpected role configuration', expected.role_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_db_role_setting AS settings
      JOIN pg_roles AS roles ON roles.oid = settings.setrole
      CROSS JOIN LATERAL unnest(settings.setconfig) AS setting
      WHERE roles.rolname = expected.role_name
        AND settings.setdatabase = database_oid
        AND setting = 'search_path=pg_catalog, public'
    ) THEN
      RAISE EXCEPTION 'Role % is missing the required search_path', expected.role_name;
    END IF;

    IF expected.role_kind IN ('readonly', 'backup')
       AND NOT EXISTS (
         SELECT 1
         FROM pg_db_role_setting AS settings
         JOIN pg_roles AS roles ON roles.oid = settings.setrole
         CROSS JOIN LATERAL unnest(settings.setconfig) AS setting
         WHERE roles.rolname = expected.role_name
           AND settings.setdatabase = database_oid
           AND setting = 'default_transaction_read_only=on'
       ) THEN
      RAISE EXCEPTION
        'Role % is missing default_transaction_read_only=on',
        expected.role_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
    JOIN pg_roles AS member_role ON member_role.oid = membership.member
    WHERE granted_role.rolname IN (
        SELECT role_name FROM expected_database_roles
      )
       OR member_role.rolname IN (
        SELECT role_name FROM expected_database_roles
      )
  ) THEN
    RAISE EXCEPTION 'Application role membership audit failed';
  END IF;
END
$audit$;

SELECT
  expected.role_kind,
  roles.rolname,
  roles.rolcanlogin,
  roles.rolsuper,
  roles.rolinherit,
  roles.rolcreatedb,
  roles.rolcreaterole,
  roles.rolreplication,
  roles.rolbypassrls
FROM expected_database_roles AS expected
JOIN pg_roles AS roles ON roles.rolname = expected.role_name
ORDER BY expected.role_kind;

COMMIT;
