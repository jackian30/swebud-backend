#!/bin/sh
set -eu
umask 077

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

fail() {
  echo "$*" >&2
  exit 1
}

read_secret() {
  target_name="$1"
  secret_path="$2"

  [ -n "$secret_path" ] || fail "${target_name}_FILE is required."
  case "$secret_path" in
    /*) ;;
    *) fail "${target_name}_FILE must be an absolute path." ;;
  esac
  [ ! -L "$secret_path" ] || fail "${target_name}_FILE cannot be a symbolic link."
  [ -f "$secret_path" ] || fail "${target_name}_FILE must reference a regular file."
  [ -r "$secret_path" ] || fail "${target_name}_FILE is not readable."

  secret_size="$(wc -c < "$secret_path" | tr -d '[:space:]')"
  [ "$secret_size" -gt 0 ] || fail "${target_name}_FILE is empty."
  [ "$secret_size" -le 16384 ] || fail "${target_name}_FILE is unexpectedly large."

  secret_value="$(cat -- "$secret_path")"
  case "$secret_value" in
    *'
'*) fail "${target_name}_FILE must contain exactly one line." ;;
  esac

  export "$target_name=$secret_value"
}

validate_role_name() {
  variable_name="$1"
  role_name="$2"

  case "$role_name" in
    *[!A-Za-z0-9_]*|[0-9]*|'')
      fail "$variable_name must be a valid unquoted PostgreSQL role identifier."
      ;;
  esac
  [ "${#role_name}" -le 63 ] ||
    fail "$variable_name cannot exceed 63 characters."
}

: "${DATABASE_RUNTIME_USER:?DATABASE_RUNTIME_USER is required.}"
: "${DATABASE_ADMIN_READONLY_USER:?DATABASE_ADMIN_READONLY_USER is required.}"
: "${DATABASE_BACKUP_USER:?DATABASE_BACKUP_USER is required.}"

validate_role_name DATABASE_RUNTIME_USER "$DATABASE_RUNTIME_USER"
validate_role_name DATABASE_ADMIN_READONLY_USER "$DATABASE_ADMIN_READONLY_USER"
validate_role_name DATABASE_BACKUP_USER "$DATABASE_BACKUP_USER"

if [ "$DATABASE_RUNTIME_USER" = "$DATABASE_ADMIN_READONLY_USER" ] ||
   [ "$DATABASE_RUNTIME_USER" = "$DATABASE_BACKUP_USER" ] ||
   [ "$DATABASE_ADMIN_READONLY_USER" = "$DATABASE_BACKUP_USER" ]; then
  fail "Runtime, admin read-only, and backup database roles must be different."
fi

read_secret DIRECT_URL "${DIRECT_URL_FILE:-}"
read_secret DATABASE_RUNTIME_PASSWORD "${DATABASE_RUNTIME_PASSWORD_FILE:-}"
read_secret DATABASE_ADMIN_READONLY_PASSWORD "${DATABASE_ADMIN_READONLY_PASSWORD_FILE:-}"
read_secret DATABASE_BACKUP_PASSWORD "${DATABASE_BACKUP_PASSWORD_FILE:-}"

if [ "${#DATABASE_RUNTIME_PASSWORD}" -lt 32 ] ||
   [ "${#DATABASE_ADMIN_READONLY_PASSWORD}" -lt 32 ] ||
   [ "${#DATABASE_BACKUP_PASSWORD}" -lt 32 ]; then
  fail "Database role passwords must contain at least 32 characters."
fi

if [ "$DATABASE_RUNTIME_PASSWORD" = "$DATABASE_ADMIN_READONLY_PASSWORD" ] ||
   [ "$DATABASE_RUNTIME_PASSWORD" = "$DATABASE_BACKUP_PASSWORD" ] ||
   [ "$DATABASE_ADMIN_READONLY_PASSWORD" = "$DATABASE_BACKUP_PASSWORD" ]; then
  fail "Runtime, admin read-only, and backup database passwords must be different."
fi

owner_role="$(
  PGDATABASE="$DIRECT_URL" \
    PGCONNECT_TIMEOUT="${DATABASE_CONNECT_TIMEOUT_SECONDS:-10}" \
    psql \
      --no-psqlrc \
      --tuples-only \
      --no-align \
      --set ON_ERROR_STOP=1 \
      --command 'SELECT current_user'
)"

case "$owner_role" in
  "$DATABASE_RUNTIME_USER"|"$DATABASE_ADMIN_READONLY_USER"|"$DATABASE_BACKUP_USER")
    fail "DIRECT_URL must authenticate as a separate migration owner, not an application role."
    ;;
esac

PGDATABASE="$DIRECT_URL" \
  PGCONNECT_TIMEOUT="${DATABASE_CONNECT_TIMEOUT_SECONDS:-10}" \
  psql \
    --no-psqlrc \
    --set ON_ERROR_STOP=1 \
    --file "$SCRIPT_DIR/database-roles.sql"

echo "Database runtime, admin read-only, and backup roles are transactionally reconciled and audited."
