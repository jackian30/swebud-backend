#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/swebudd-deployment-audit.XXXXXXXX")"
PROD_CONFIG="$AUDIT_DIR/production.yml"
DEV_CONFIG="$AUDIT_DIR/development.yml"
AUDIT_ENV="$AUDIT_DIR/audit.env"
FAILURE_OUTPUT="$AUDIT_DIR/failure.out"
FAILURE_HOOK="$AUDIT_DIR/failure-hook"
BACKUP_OUTPUT="$AUDIT_DIR/backups"
SECRET_DIR="$AUDIT_DIR/secrets"
SIGNATURE_FIXTURE="$AUDIT_DIR/signature-fixture"
S3_FIXTURE_DIR="$AUDIT_DIR/s3-fixtures"

cleanup() {
  case "$AUDIT_DIR" in
    "${TMPDIR:-/tmp}"/swebudd-deployment-audit.*) rm -rf -- "$AUDIT_DIR" ;;
    *) echo "Refusing to remove unexpected audit directory: $AUDIT_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

mkdir -m 0700 \
  "$BACKUP_OUTPUT" \
  "$SECRET_DIR" \
  "$SIGNATURE_FIXTURE" \
  "$S3_FIXTURE_DIR"
cp "$SCRIPT_DIR/.env.example" "$AUDIT_ENV"
chmod 0600 "$AUDIT_ENV"
cat > "$FAILURE_HOOK" <<'HOOK'
#!/bin/sh
exit 0
HOOK
chmod 0700 "$FAILURE_HOOK"

audit_owner_password='audit-owner-secret'
audit_runtime_password='audit-runtime-password-000000000000000001'
audit_readonly_password='audit-readonly-password-000000000000000002'
audit_backup_password='audit-backup-password-000000000000000003'
audit_owner_url="$(printf 'postgresql://%s:%s@postgres:5432/audit?schema=public' \
  audit_owner "$audit_owner_password")"
audit_runtime_url="$(printf 'postgresql://%s:%s@postgres:5432/audit?schema=public' \
  audit_runtime "$audit_runtime_password")"
audit_readonly_url="$(printf 'postgresql://%s:%s@postgres:5432/audit?schema=public' \
  audit_readonly "$audit_readonly_password")"
audit_backup_url="$(printf 'postgresql://%s:%s@postgres:5432/audit?schema=public' \
  audit_backup "$audit_backup_password")"
audit_wrong_role_url="$(printf 'postgresql://%s:%s@postgres:5432/audit' \
  wrong_role "$audit_backup_password")"

printf '%s' "$audit_owner_url" \
  > "$SECRET_DIR/direct-url"
printf '%s' "$audit_runtime_password" \
  > "$SECRET_DIR/runtime-password"
printf '%s' "$audit_readonly_password" \
  > "$SECRET_DIR/readonly-password"
printf '%s' "$audit_backup_password" \
  > "$SECRET_DIR/backup-password"
chmod 0600 "$SECRET_DIR"/*
openssl genpkey \
  -algorithm ED25519 \
  -out "$SECRET_DIR/backup-signing-private.pem"
openssl pkey \
  -in "$SECRET_DIR/backup-signing-private.pem" \
  -pubout \
  -out "$SECRET_DIR/backup-signing-public.pem"
openssl genpkey \
  -algorithm ED25519 \
  -out "$SECRET_DIR/wrong-signing-private.pem"
openssl pkey \
  -in "$SECRET_DIR/wrong-signing-private.pem" \
  -pubout \
  -out "$SECRET_DIR/wrong-signing-public.pem"
chmod 0600 "$SECRET_DIR/backup-signing-private.pem" \
  "$SECRET_DIR/wrong-signing-private.pem"
chmod 0644 "$SECRET_DIR/backup-signing-public.pem" \
  "$SECRET_DIR/wrong-signing-public.pem"

audit_environment=(
  POSTGRES_DB=audit
  POSTGRES_USER=audit_owner
  POSTGRES_PASSWORD=audit-owner-password-00000000000000000004
  DATABASE_RUNTIME_USER=audit_runtime
  "DATABASE_RUNTIME_PASSWORD=$audit_runtime_password"
  "DATABASE_URL=$audit_runtime_url"
  DATABASE_ADMIN_READONLY_USER=audit_readonly
  "DATABASE_ADMIN_READONLY_PASSWORD=$audit_readonly_password"
  "DATABASE_ADMIN_READONLY_URL=$audit_readonly_url"
  DATABASE_BACKUP_USER=audit_backup
  "DATABASE_BACKUP_PASSWORD=$audit_backup_password"
  "DATABASE_BACKUP_URL=$audit_backup_url"
  "DIRECT_URL=$audit_owner_url"
  DATABASE_OWNER_URL_SECRET_FILE="$SECRET_DIR/direct-url"
  DATABASE_RUNTIME_PASSWORD_SECRET_FILE="$SECRET_DIR/runtime-password"
  DATABASE_ADMIN_READONLY_PASSWORD_SECRET_FILE="$SECRET_DIR/readonly-password"
  DATABASE_BACKUP_PASSWORD_SECRET_FILE="$SECRET_DIR/backup-password"
  JWT_SECRET=audit-access-secret-with-more-than-32-characters
  JWT_REFRESH_SECRET=audit-refresh-secret-with-more-than-32-characters
  ADMIN_JWT_SECRET=audit-admin-secret-with-more-than-32-characters
  ADMIN_JWT_ISSUER=swebudd-admin-audit
  ADMIN_JWT_AUDIENCE=swebudd-admin-moderation-audit
  CLOUDFLARE_TURNSTILE_SECRET_KEY=audit-turnstile-secret-with-more-than-32-characters
  FRONTEND_ORIGIN=https://swebudd.example
  ADMIN_ORIGIN=https://admin.swebudd.example
  ALLOW_LOCAL_ORIGINS=false
  NATIVE_AUTH_ENABLED=false
  SMTP_HOST=smtp.example
  SMTP_REQUIRE_TLS=true
  SMTP_IGNORE_TLS=false
  SMTP_TLS_REJECT_UNAUTHORIZED=true
  "MAIL_FROM=SweBudd <no-reply@example.com>"
  MEDIA_STORAGE_DRIVER=s3
  MEDIA_S3_BUCKET=audit-public-media
  MEDIA_S3_PREFIX=
  MEDIA_PUBLIC_BASE_URL=https://media.swebudd.example/
  MEDIA_QUARANTINE_S3_BUCKET=audit-private-quarantine
  AWS_REGION=ap-southeast-1
  BACKUP_OUTPUT_DIR="$BACKUP_OUTPUT"
  BACKUP_AGE_RECIPIENT=age1auditrecipientnotusedbytheconfigurationaudit
  BACKUP_SIGNING_PRIVATE_KEY_FILE="$SECRET_DIR/backup-signing-private.pem"
  BACKUP_SIGNING_PUBLIC_KEY_FILE="$SECRET_DIR/backup-signing-public.pem"
  BACKUP_ALLOW_LOCAL_ONLY=true
  BACKUP_OFFSITE_RETENTION_CONFIRMED=false
  BACKUP_RETENTION_DAYS=30
  BACKUP_RPO_HOURS=24
  BACKUP_RTO_HOURS=4
  FAILURE_ALERT_HOOK="$FAILURE_HOOK"
  RESTORE_EXPECTED_PROJECT=swebud-audit
  RESTORE_EXPECTED_DATABASE_NAME=audit
)

env "${audit_environment[@]}" \
  docker compose \
    -p swebud-audit \
    --env-file "$AUDIT_ENV" \
    -f "$SCRIPT_DIR/docker-compose.yml" \
    config > "$PROD_CONFIG"
env "${audit_environment[@]}" \
  docker compose \
    -p swebud-audit \
    --env-file "$AUDIT_ENV" \
    -f "$SCRIPT_DIR/docker-compose-dev.yml" \
    config > "$DEV_CONFIG"

service_section() {
  local config="$1"
  local service="$2"
  sed -n "/^  ${service}:/,/^  [A-Za-z0-9_-]\\+:$/p" "$config"
}

if grep -q '^  mailhog:' "$PROD_CONFIG"; then
  echo "Production Compose unexpectedly includes MailHog." >&2
  exit 1
fi
postgres_section="$(service_section "$PROD_CONFIG" postgres)"
if grep -q 'published:' <<< "$postgres_section"; then
  echo "Production PostgreSQL unexpectedly publishes a host port." >&2
  exit 1
fi
grep -q 'postgres@sha256:4e6e670b' <<< "$postgres_section"
grep -q 'read_only: true' "$PROD_CONFIG"
grep -q 'no-new-privileges:true' "$PROD_CONFIG"
grep -q 'host_ip: 127.0.0.1' "$DEV_CONFIG"
grep -q '^  mailhog:' "$DEV_CONFIG"
grep -q 'deployment/Dockerfile.dev' "$SCRIPT_DIR/docker-compose-dev.yml"
grep -q "^USER \${LOCAL_UID}:\${LOCAL_GID}$" "$SCRIPT_DIR/Dockerfile.dev"
grep -q '/app/media-processing-tmp' "$SCRIPT_DIR/../Dockerfile"
grep -q '/app/media-processing-tmp' "$SCRIPT_DIR/Dockerfile.dev"

clamav_section="$(service_section "$PROD_CONFIG" clamav)"
if grep -q 'published:' <<< "$clamav_section"; then
  echo "Production ClamAV unexpectedly publishes a host port." >&2
  exit 1
fi
grep -q 'clamav/clamav@sha256:7f5389cc' <<< "$clamav_section"
grep -q 'CLAMD_CONF_StreamMaxLength: 128M' <<< "$clamav_section"
grep -q 'CLAMAV_NO_FRESHCLAMD: "true"' <<< "$clamav_section"
grep -q 'clamdcheck.sh' <<< "$clamav_section"
grep -q '^  malware:$' "$PROD_CONFIG"
grep -A3 '^  malware:$' "$PROD_CONFIG" | grep -q 'internal: true'

for rendered_config in "$PROD_CONFIG" "$DEV_CONFIG"; do
  backend_section="$(service_section "$rendered_config" backend)"
  grep -q 'MEDIA_PROCESSING_TEMP_DIR: /app/media-processing-tmp' <<< "$backend_section"
  grep -q 'MEDIA_LEGACY_QUARANTINE_DIR: /app/media-processing-tmp/legacy-quarantine' <<< "$backend_section"
  grep -q 'source: swebud_media_processing_temp' <<< "$backend_section"
  grep -q 'target: /app/media-processing-tmp' <<< "$backend_section"
  if grep -Eq 'MEDIA_PROCESSING_TEMP_DIR: /tmp|target: /tmp' <<< "$backend_section"; then
    echo "Media processing files must not use the memory-backed /tmp filesystem." >&2
    exit 1
  fi
done
prod_backend_section="$(service_section "$PROD_CONFIG" backend)"
grep -q 'MEDIA_STORAGE_DRIVER: s3' <<< "$prod_backend_section"
grep -q 'MEDIA_S3_BUCKET: audit-public-media' <<< "$prod_backend_section"
grep -q 'MEDIA_QUARANTINE_S3_BUCKET: audit-private-quarantine' <<< "$prod_backend_section"
grep -q 'MEDIA_UPLOAD_WORKER_ENABLED: "true"' <<< "$prod_backend_section"
grep -q 'MEDIA_LEGACY_PROXY_UPLOADS_ENABLED: "false"' <<< "$prod_backend_section"
grep -q 'MEDIA_MALWARE_SCANNER: clamd-tcp' <<< "$prod_backend_section"
grep -q 'MEDIA_CLAMD_TCP_HOST: clamav' <<< "$prod_backend_section"
grep -q 'MEDIA_CLAMD_TRUSTED_NETWORK: "true"' <<< "$prod_backend_section"
grep -q 'condition: service_healthy' <<< "$prod_backend_section"
if [[ "$(grep -c 'GARMIN_CONSUMER_KEY:' "$SCRIPT_DIR/docker-compose.yml")" -ne 1 ||
      "$(grep -c 'GARMIN_CONSUMER_KEY:' "$SCRIPT_DIR/docker-compose-dev.yml")" -ne 1 ]]; then
  echo "Compose must define GARMIN_CONSUMER_KEY exactly once per backend service." >&2
  exit 1
fi

db_roles_section="$(service_section "$PROD_CONFIG" db-roles)"
migrate_section="$(service_section "$PROD_CONFIG" migrate)"
for secret_value in \
  audit-owner-secret \
  audit-runtime-password-000000000000000001 \
  audit-readonly-password-000000000000000002 \
  audit-backup-password-000000000000000003
do
  if grep -Fq "$secret_value" <<< "$db_roles_section$migrate_section"; then
    echo "Production one-shot Compose configuration embeds a database credential." >&2
    exit 1
  fi
done
grep -q 'DIRECT_URL_FILE: /run/secrets/database_owner_url' <<< "$db_roles_section"
grep -q 'DATABASE_BACKUP_PASSWORD_FILE: /run/secrets/database_backup_password' <<< "$db_roles_section"
grep -q 'DIRECT_URL_FILE: /run/secrets/database_owner_url' <<< "$migrate_section"
grep -q 'database_owner_url' "$PROD_CONFIG"
grep -q 'database_backup_password' "$PROD_CONFIG"
if grep -Eq 'DATABASE_(RUNTIME|ADMIN_READONLY|BACKUP)_PASSWORD:' \
  "$SCRIPT_DIR/docker-compose.yml"; then
  echo "Production one-shot jobs expose a role password through environment." >&2
  exit 1
fi
if grep -Eq '^[[:space:]]+DIRECT_URL:.*\\$\\{DIRECT_URL' \
  "$SCRIPT_DIR/docker-compose.yml"; then
  echo "Production one-shot jobs expose DIRECT_URL through persistent environment." >&2
  exit 1
fi
grep -q 'ADMIN_JWT_SECRET:' "$(realpath "$SCRIPT_DIR/docker-compose.yml")"
grep -q 'ADMIN_JWT_ISSUER:' "$SCRIPT_DIR/docker-compose.yml"
grep -q 'ADMIN_JWT_AUDIENCE:' "$SCRIPT_DIR/docker-compose.yml"

if grep -q 'apk add' <(
  sed -n '/^[[:space:]]*command:/,/^[[:space:]]*ports:/p' \
    "$SCRIPT_DIR/docker-compose-dev.yml"
); then
  echo "Development startup command installs packages at runtime." >&2
  exit 1
fi

for bash_script in \
  audit.sh backup.sh deploy.sh restore-drill.sh rollback-image.sh \
  verify-backup-signature.sh verify-media-backup-references.sh \
  verify-s3-backup-sidecar.sh
do
  bash -n "$SCRIPT_DIR/$bash_script"
  [[ "$(stat -c '%a' "$SCRIPT_DIR/$bash_script")" == "755" ]] || {
    echo "$bash_script must have mode 0755." >&2
    exit 1
  }
done
sh -n "$SCRIPT_DIR/provision-database-roles.sh"
[[ "$(stat -c '%a' "$SCRIPT_DIR/provision-database-roles.sh")" == "755" ]]
for sql_file in \
  database-roles.sql backup-media-references.sql backup-metadata.sql \
  migration-state.sql
do
  [[ "$(stat -c '%a' "$SCRIPT_DIR/$sql_file")" == "644" ]] || {
    echo "$sql_file must have mode 0644." >&2
    exit 1
  }
done

role_sql="$SCRIPT_DIR/database-roles.sql"
grep -q '^BEGIN;$' "$role_sql"
grep -q 'pg_advisory_xact_lock' "$role_sql"
grep -q 'ALTER ROLE %I RESET ALL' "$role_sql"
grep -q 'pg_auth_members' "$role_sql"
grep -q 'must not own database objects' "$role_sql"
grep -q 'REVOKE CONNECT, CREATE, TEMPORARY.*PUBLIC' "$role_sql"
grep -q 'REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC' "$role_sql"
grep -q 'REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC' "$role_sql"
grep -q 'default_transaction_read_only = on' "$role_sql"
grep -q "role_kind = 'backup'" "$role_sql"
grep -q 'unexpected table privileges' "$role_sql"
grep -q 'unexpected sequence privileges' "$role_sql"
grep -q '^COMMIT;$' "$role_sql"

provision_script="$SCRIPT_DIR/provision-database-roles.sh"
grep -q 'DIRECT_URL_FILE' "$provision_script"
grep -q 'PGDATABASE="$DIRECT_URL"' "$provision_script"
if grep -Eq 'psql[[:space:]]+"?\\$DIRECT_URL' "$provision_script"; then
  echo "Role provisioning exposes the owner URL on psql argv." >&2
  exit 1
fi
grep -q 'database passwords must be different' "$provision_script"

backup_script="$SCRIPT_DIR/backup.sh"
grep -q 'DATABASE_BACKUP_URL' "$backup_script"
if grep -q 'resolved_value DIRECT_URL' "$backup_script"; then
  echo "Backup script must never fall back to DIRECT_URL." >&2
  exit 1
fi
grep -q '\.partial' "$backup_script"
grep -q 'manifest.age' "$backup_script"
grep -q 'COMPLETE' "$backup_script"
grep -q 'COMPLETE.sig' "$backup_script"
grep -q 'BACKUP_SIGNING_PRIVATE_KEY_FILE' "$backup_script"
grep -q 'pkeyutl' "$backup_script"
grep -q -- '-sign' "$backup_script"
grep -q 'BACKUP_ALLOW_LOCAL_ONLY' "$backup_script"
grep -q 'BACKUP_OFFSITE_RETENTION_CONFIRMED' "$backup_script"
grep -q 'BACKUP_RETENTION_DAYS' "$backup_script"
grep -q 's3 sync' "$backup_script"
grep -q 's3api head-object' "$backup_script"
grep -q 's3api get-object-tagging' "$backup_script"
grep -q 'MEDIA_QUARANTINE_S3_BUCKET' "$backup_script"
grep -q "nonempty MEDIA_S3_PREFIX must end in '/'" "$backup_script"
grep -q 'swebudd-s3-object-metadata-v2' "$backup_script"
grep -q 's3-dual-store-with-metadata-v1' "$backup_script"
grep -q 'export_s3_store public' "$backup_script"
grep -q 'export_s3_store quarantine' "$backup_script"
grep -q 'verify-media-backup-references.sh' "$backup_script"
grep -q 'backup-media-references.sql' "$backup_script"
grep -q 'stop --timeout 60 backend' "$backup_script"
grep -q 'restart_backend' "$backup_script"
grep -q 'FAILURE_ALERT_HOOK' "$backup_script"
grep -q -- '--network none' "$backup_script"
if grep -Eq -- '--env[ =]+[^[:space:]]*(DATABASE|DIRECT).*URL' "$backup_script"; then
  echo "Backup script exposes a database URL through Docker environment argv." >&2
  exit 1
fi

restore_script="$SCRIPT_DIR/restore-drill.sh"
grep -q 'exact five-file allowlist' "$restore_script"
grep -q 'BACKUP_SIGNING_PUBLIC_KEY_FILE' "$restore_script"
grep -q 'verify-backup-signature.sh' "$restore_script"
grep -q 'verify-s3-backup-sidecar.sh' "$restore_script"
grep -q 'verify-media-backup-references.sh' "$restore_script"
grep -q 's3-dual-store-with-metadata-v1' "$restore_script"
grep -q 'stores/public/s3-object-metadata.json' "$restore_script"
grep -q 'stores/quarantine/s3-object-metadata.json' "$restore_script"
grep -q 'pg_restore' "$restore_script"
grep -q 'age --decrypt.*database.dump.age' "$restore_script"
grep -q 'com.swebudd.restore-id' "$restore_script"
grep -q 'openssl rand -hex 16' "$restore_script"
grep -q -- '--network none' "$restore_script"
grep -q 'RESTORE_MAX_RPO_HOURS' "$restore_script"
grep -q 'RESTORE_MAX_RTO_HOURS' "$restore_script"
grep -q 'postgres_image="$(resolved_value POSTGRES_HELPER_IMAGE)"' "$restore_script"
grep -q 'media_image="$(resolved_value MEDIA_HELPER_IMAGE)"' "$restore_script"
grep -Fq 'manifest[postgres_helper_image]}" == "$postgres_image"' "$restore_script"
grep -Fq 'manifest[media_helper_image]}" == "$media_image"' "$restore_script"
grep -q 'tar -xzf - -o -C /restore' "$restore_script"
if grep -Fq 'postgres_image="${manifest[' "$restore_script" ||
   grep -Fq 'media_image="${manifest[' "$restore_script"; then
  echo "Restore drill must never execute a helper image selected by a backup manifest." >&2
  exit 1
fi
if grep -q 'docker cp' "$restore_script" ||
   grep -Eq 'database_dump=|--output .*database\\.dump' "$restore_script"; then
  echo "Restore drill materializes a plaintext database dump." >&2
  exit 1
fi

deploy_script="$SCRIPT_DIR/deploy.sh"
grep -q 'require_value BACKUP_SIGNING_PRIVATE_KEY_FILE' "$deploy_script"
grep -q 'validate_backup_signing_private_key' "$deploy_script"
grep -q 'validate_production_media' "$deploy_script"
grep -q 'MEDIA_QUARANTINE_S3_BUCKET must be separate' "$deploy_script"
grep -q 'CLAMAV_IMAGE' "$deploy_script"

signature_verify_line="$(
  grep -n 'verify-backup-signature.sh' "$restore_script" |
    head -n 1 |
    cut -d: -f1
)"
first_decrypt_line="$(
  grep -n 'age.*--decrypt' "$restore_script" |
    head -n 1 |
    cut -d: -f1
)"
[[ "$signature_verify_line" =~ ^[0-9]+$ &&
   "$first_decrypt_line" =~ ^[0-9]+$ &&
   "$signature_verify_line" -lt "$first_decrypt_line" ]] || {
  echo "Restore must verify the creator signature before any age decryption." >&2
  exit 1
}

cat > "$SIGNATURE_FIXTURE/COMPLETE" <<'MARKER'
format=swebudd-backup-v2
backup_id=0123456789abcdef0123456789abcdef
manifest_sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
signing_algorithm=ed25519
MARKER
openssl pkeyutl \
  -sign \
  -rawin \
  -inkey "$SECRET_DIR/backup-signing-private.pem" \
  -in "$SIGNATURE_FIXTURE/COMPLETE" \
  -out "$SIGNATURE_FIXTURE/COMPLETE.sig"
"$SCRIPT_DIR/verify-backup-signature.sh" \
  "$SIGNATURE_FIXTURE" \
  "$SECRET_DIR/backup-signing-public.pem" >/dev/null
cp "$SIGNATURE_FIXTURE/COMPLETE" "$SIGNATURE_FIXTURE/COMPLETE.valid"
printf '%s\n' 'tampered=true' >> "$SIGNATURE_FIXTURE/COMPLETE"
if "$SCRIPT_DIR/verify-backup-signature.sh" \
  "$SIGNATURE_FIXTURE" \
  "$SECRET_DIR/backup-signing-public.pem" >/dev/null 2>&1; then
  echo "Creator-signature verification accepted a tampered marker." >&2
  exit 1
fi
mv "$SIGNATURE_FIXTURE/COMPLETE.valid" "$SIGNATURE_FIXTURE/COMPLETE"
if "$SCRIPT_DIR/verify-backup-signature.sh" \
  "$SIGNATURE_FIXTURE" \
  "$SECRET_DIR/wrong-signing-public.pem" >/dev/null 2>&1; then
  echo "Creator-signature verification accepted the wrong public key." >&2
  exit 1
fi

# Exercise both independent S3 inventories. Each store must reject a modified
# sidecar, an authenticated count mismatch, and an unsafe archive path.
write_s3_sidecar_fixture() {
  local store="$1"
  local bucket="$2"
  local prefix="$3"
  local relative_path="$4"
  local destination="$5"
  jq -nS \
    --arg store "$store" \
    --arg bucket "$bucket" \
    --arg prefix "$prefix" \
    --arg relative_path "$relative_path" '
      {
        format: "swebudd-s3-object-metadata-v2",
        store: $store,
        source: {
          bucket: $bucket,
          prefix: $prefix
        },
        objects: [
          {
            key: ($prefix + $relative_path),
            relativePath: $relative_path,
            directoryMarker: false,
            size: 19,
            contentType: "application/octet-stream",
            cacheControl: null,
            contentDisposition: null,
            contentEncoding: null,
            contentLanguage: null,
            expires: null,
            websiteRedirectLocation: null,
            metadata: {
              fixture: $store
            },
            tags: [
              {
                Key: "store",
                Value: $store
              }
            ]
          }
        ]
      }
    ' > "$destination"
}

for store in public quarantine; do
  if [[ "$store" == "public" ]]; then
    fixture_bucket="audit-public-bucket"
    fixture_prefix="uploads/"
    fixture_relative_path="asset-a.bin"
  else
    fixture_bucket="audit-quarantine-bucket"
    fixture_prefix=""
    fixture_relative_path="sessions/source-a.bin"
  fi
  fixture_sidecar="$S3_FIXTURE_DIR/${store}.json"
  fixture_expected_paths="$S3_FIXTURE_DIR/${store}.paths"
  fixture_source="s3://${fixture_bucket}/${fixture_prefix}"
  write_s3_sidecar_fixture \
    "$store" \
    "$fixture_bucket" \
    "$fixture_prefix" \
    "$fixture_relative_path" \
    "$fixture_sidecar"
  fixture_hash="$(sha256sum "$fixture_sidecar" | awk '{print $1}')"
  "$SCRIPT_DIR/verify-s3-backup-sidecar.sh" \
    "$store" \
    "$fixture_sidecar" \
    "$fixture_hash" \
    1 \
    "$fixture_source" > "$fixture_expected_paths"
  grep -Fxq "./$fixture_relative_path" "$fixture_expected_paths"

  cp "$fixture_sidecar" "$S3_FIXTURE_DIR/${store}-tampered.json"
  printf '\n' >> "$S3_FIXTURE_DIR/${store}-tampered.json"
  if "$SCRIPT_DIR/verify-s3-backup-sidecar.sh" \
    "$store" \
    "$S3_FIXTURE_DIR/${store}-tampered.json" \
    "$fixture_hash" \
    1 \
    "$fixture_source" >/dev/null 2>&1; then
    echo "$store sidecar verifier accepted tampered metadata." >&2
    exit 1
  fi
  if "$SCRIPT_DIR/verify-s3-backup-sidecar.sh" \
    "$store" \
    "$fixture_sidecar" \
    "$fixture_hash" \
    2 \
    "$fixture_source" >/dev/null 2>&1; then
    echo "$store sidecar verifier accepted an incorrect object count." >&2
    exit 1
  fi

  jq '
    .objects[0].relativePath = "../escape" |
    .objects[0].key = (.source.prefix + "../escape")
  ' "$fixture_sidecar" > "$S3_FIXTURE_DIR/${store}-unsafe-path.json"
  unsafe_hash="$(
    sha256sum "$S3_FIXTURE_DIR/${store}-unsafe-path.json" |
      awk '{print $1}'
  )"
  if "$SCRIPT_DIR/verify-s3-backup-sidecar.sh" \
    "$store" \
    "$S3_FIXTURE_DIR/${store}-unsafe-path.json" \
    "$unsafe_hash" \
    1 \
    "$fixture_source" >/dev/null 2>&1; then
    echo "$store sidecar verifier accepted an unsafe relative path." >&2
    exit 1
  fi
done

# Persisted database bucket/key references are bound to both sidecars. This
# catches bucket rotation and same-bucket prefix rotation before backup output
# is finalized.
jq -nS '
  {
    format: "swebudd-media-backup-references-v1",
    public: [
      {
        bucket: "audit-public-bucket",
        key: "uploads/asset-a.bin"
      }
    ],
    quarantine: [
      {
        bucket: "audit-quarantine-bucket",
        key: "sessions/source-a.bin"
      }
    ],
    unfinishedMultipart: [
      {
        bucket: "audit-quarantine-bucket",
        sessionCount: 2
      }
    ]
  }
' > "$S3_FIXTURE_DIR/media-references.json"
reference_summary="$(
  "$SCRIPT_DIR/verify-media-backup-references.sh" \
    "$S3_FIXTURE_DIR/media-references.json" \
    audit-public-bucket \
    audit-quarantine-bucket \
    "$S3_FIXTURE_DIR/public.json" \
    "$S3_FIXTURE_DIR/quarantine.json"
)"
[[ "$reference_summary" == "1|1|2" ]]

jq '.public[0].bucket = "rotated-public-bucket"' \
  "$S3_FIXTURE_DIR/media-references.json" \
  > "$S3_FIXTURE_DIR/media-references-rotated-public.json"
if "$SCRIPT_DIR/verify-media-backup-references.sh" \
  "$S3_FIXTURE_DIR/media-references-rotated-public.json" \
  audit-public-bucket \
  audit-quarantine-bucket \
  "$S3_FIXTURE_DIR/public.json" \
  "$S3_FIXTURE_DIR/quarantine.json" >/dev/null 2>&1; then
  echo "Media-reference verifier accepted a rotated public bucket." >&2
  exit 1
fi

jq '.unfinishedMultipart[0].bucket = "rotated-quarantine-bucket"' \
  "$S3_FIXTURE_DIR/media-references.json" \
  > "$S3_FIXTURE_DIR/media-references-rotated-quarantine.json"
if "$SCRIPT_DIR/verify-media-backup-references.sh" \
  "$S3_FIXTURE_DIR/media-references-rotated-quarantine.json" \
  audit-public-bucket \
  audit-quarantine-bucket \
  "$S3_FIXTURE_DIR/public.json" \
  "$S3_FIXTURE_DIR/quarantine.json" >/dev/null 2>&1; then
  echo "Media-reference verifier accepted a rotated quarantine bucket." >&2
  exit 1
fi

jq '.quarantine[0].bucket = "rotated-quarantine-bucket"' \
  "$S3_FIXTURE_DIR/media-references.json" \
  > "$S3_FIXTURE_DIR/media-references-rotated-durable-quarantine.json"
if "$SCRIPT_DIR/verify-media-backup-references.sh" \
  "$S3_FIXTURE_DIR/media-references-rotated-durable-quarantine.json" \
  audit-public-bucket \
  audit-quarantine-bucket \
  "$S3_FIXTURE_DIR/public.json" \
  "$S3_FIXTURE_DIR/quarantine.json" >/dev/null 2>&1; then
  echo "Media-reference verifier accepted a durable object in a rotated quarantine bucket." >&2
  exit 1
fi

jq '.public[0].key = "old-prefix/asset-a.bin"' \
  "$S3_FIXTURE_DIR/media-references.json" \
  > "$S3_FIXTURE_DIR/media-references-rotated-prefix.json"
if "$SCRIPT_DIR/verify-media-backup-references.sh" \
  "$S3_FIXTURE_DIR/media-references-rotated-prefix.json" \
  audit-public-bucket \
  audit-quarantine-bucket \
  "$S3_FIXTURE_DIR/public.json" \
  "$S3_FIXTURE_DIR/quarantine.json" >/dev/null 2>&1; then
  echo "Media-reference verifier accepted a public key outside the exported prefix." >&2
  exit 1
fi

# A valid local-volume backup can contain files whose source uid/gid differ
# from the restore runner. Exercise the exact ownership-normalizing extraction
# mode under a non-root user with every capability removed.
mkdir -m 0700 "$AUDIT_DIR/media-source" "$AUDIT_DIR/media-restore"
printf '%s\n' 'synthetic media payload' > "$AUDIT_DIR/media-source/non-root-owned.txt"
tar \
  --create \
  --gzip \
  --file "$AUDIT_DIR/non-root-owned-media.tar.gz" \
  --numeric-owner \
  --owner 12345 \
  --group 23456 \
  --directory "$AUDIT_DIR/media-source" \
  non-root-owned.txt
docker run --rm \
  --interactive \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=8m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --user "$(id -u):$(id -g)" \
  --volume "$AUDIT_DIR/media-restore:/restore" \
  'alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc' \
  sh -ceu '
    tar -xzf - -o -C /restore
    test "$(stat -c "%u:%g" /restore/non-root-owned.txt)" = "$(id -u):$(id -g)"
  ' < "$AUDIT_DIR/non-root-owned-media.tar.gz"

rollback_script="$SCRIPT_DIR/rollback-image.sh"
grep -q 'I_HAVE_VERIFIED_BACKWARD_COMPATIBILITY' "$rollback_script"
grep -q -- '--wait-timeout 180' "$rollback_script"
grep -q 'backend_image_id' "$rollback_script"
grep -q 'Database schema was not changed or downgraded' "$rollback_script"
if grep -Eq 'prisma|migrate|pg_restore|psql' "$rollback_script"; then
  echo "Image rollback must not mutate database schema or data." >&2
  exit 1
fi

for key in \
  DATABASE_RUNTIME_USER DATABASE_RUNTIME_PASSWORD \
  DATABASE_ADMIN_READONLY_USER DATABASE_ADMIN_READONLY_PASSWORD DATABASE_ADMIN_READONLY_URL \
  DATABASE_BACKUP_USER DATABASE_BACKUP_PASSWORD DATABASE_BACKUP_URL \
  ADMIN_JWT_SECRET ADMIN_JWT_ISSUER ADMIN_JWT_AUDIENCE \
  POSTGRES_IMAGE POSTGRES_HELPER_IMAGE MEDIA_HELPER_IMAGE CLAMAV_IMAGE \
  MEDIA_S3_BUCKET MEDIA_S3_PREFIX MEDIA_PUBLIC_BASE_URL \
  MEDIA_QUARANTINE_S3_BUCKET AWS_REGION AWS_S3_ENDPOINT AWS_S3_FORCE_PATH_STYLE \
  MEDIA_UPLOAD_MAX_ACTIVE_PER_USER MEDIA_UPLOAD_ROLLING_QUOTA_BYTES \
  MEDIA_UPLOAD_ROLLING_QUOTA_HOURS MEDIA_UPLOAD_PART_BYTES \
  MEDIA_UPLOAD_SESSION_TTL_SECONDS MEDIA_UPLOAD_URL_TTL_SECONDS \
  MEDIA_UPLOAD_WORKER_CONCURRENCY MEDIA_UPLOAD_JOB_MAX_ATTEMPTS \
  MEDIA_UPLOAD_JOB_LEASE_SECONDS MEDIA_UPLOAD_WORKER_POLL_MS \
  MEDIA_S3_REQUEST_TIMEOUT_MS MEDIA_S3_DOWNLOAD_TIMEOUT_MS \
  MEDIA_MULTIPART_COMPLETE_TIMEOUT_MS MEDIA_UPLOAD_COMPLETION_STALE_SECONDS \
  MEDIA_QUARANTINE_CLEANUP_TOMBSTONE_SECONDS MEDIA_PUBLISH_TIMEOUT_MS \
  MEDIA_PUBLISH_CLEANUP_GRACE_SECONDS MEDIA_PUBLISH_CLEANUP_TOMBSTONE_SECONDS \
  MEDIA_PROCESSING_CONCURRENCY MEDIA_PROCESSING_MAX_QUEUE \
  MEDIA_PROCESSING_STALE_TEMP_SECONDS MEDIA_PROCESSING_STALE_CLEANUP_LIMIT \
  MEDIA_MALWARE_SCAN_TIMEOUT_MS \
  BACKUP_OUTPUT_DIR BACKUP_AGE_RECIPIENT \
  BACKUP_SIGNING_PRIVATE_KEY_FILE BACKUP_SIGNING_PUBLIC_KEY_FILE BACKUP_S3_URI \
  BACKUP_ALLOW_LOCAL_ONLY BACKUP_OFFSITE_RETENTION_CONFIRMED \
  BACKUP_RETENTION_DAYS BACKUP_RPO_HOURS BACKUP_RTO_HOURS \
  FAILURE_ALERT_HOOK RESTORE_MAX_RPO_HOURS RESTORE_MAX_RTO_HOURS
do
  grep -q "^${key}=" "$SCRIPT_DIR/.env.example"
done
grep -Fxq 'deployment/.secrets/' "$SCRIPT_DIR/../.gitignore"
grep -Fxq 'deployment/.deployment-state/' "$SCRIPT_DIR/../.gitignore"

# Every supported migration path uses the immutable compatibility preparation.
node - "$SCRIPT_DIR/../package.json" <<'NODE'
const packageJson = require(process.argv[2]);
if (packageJson.scripts['prisma:prepare-deploy'] !== 'node scripts/prepare-compatible-migrations.js') {
  throw new Error('prisma:prepare-deploy does not run the compatibility preparation script');
}
if (packageJson.scripts['prisma:deploy'] !== 'node scripts/deploy-migrations.js') {
  throw new Error('prisma:deploy must use the compatibility-aware migration runner');
}
NODE
grep -q 'node scripts/deploy-migrations.js' "$SCRIPT_DIR/docker-compose.yml"
grep -q 'npm run prisma:deploy' "$SCRIPT_DIR/docker-compose-dev.yml"
if grep -q 'npx prisma migrate deploy' \
  "$SCRIPT_DIR/docker-compose.yml" \
  "$SCRIPT_DIR/docker-compose-dev.yml"
then
  echo "A Compose service bypasses the compatibility-aware Prisma deploy script." >&2
  exit 1
fi
grep -q "require('./render-start')" "$SCRIPT_DIR/../scripts/deploy-migrations.js"
grep -q 'prepare-compatible-migrations.js' "$SCRIPT_DIR/../scripts/render-start.js"
grep -q "require('./render-start')" "$SCRIPT_DIR/../scripts/docker-entrypoint.js"
grep -q '^ENTRYPOINT \["node", "scripts/docker-entrypoint.js"\]$' "$SCRIPT_DIR/../Dockerfile"
git -C "$SCRIPT_DIR/.." diff --exit-code HEAD -- \
  prisma/migrations/20260716143000_drop_chat_private_key/migration.sql \
  prisma/migrations/20260716161000_coalesce_pending_message_requests/migration.sql
grep -q 'ADD COLUMN IF NOT EXISTS "chat_private_key"' \
  "$SCRIPT_DIR/../prisma/migrations/20260716235000_restore_legacy_chat_column_for_rollback/migration.sql"
grep -q 'DROP INDEX IF EXISTS "message_requests_one_pending_pair_key"' \
  "$SCRIPT_DIR/../prisma/migrations/20260716235000_restore_legacy_chat_column_for_rollback/migration.sql"

node --test "$SCRIPT_DIR/../scripts/render-start.test.js"
node --test "$SCRIPT_DIR/../scripts/docker-entrypoint.test.js"
node --test "$SCRIPT_DIR/../scripts/prepare-compatible-migrations.test.js"
node --test "$SCRIPT_DIR/../scripts/smoke-live-cors.test.js"

if [[ "$(head -n 1 "$SCRIPT_DIR/../src/main.ts")" != "import './common/render-environment';" ]]; then
  echo "Render environment migration is not the first backend bootstrap import." >&2
  exit 1
fi
grep -q 'normalizeLegacyRenderBrowserOrigins();' \
  "$SCRIPT_DIR/../src/common/render-environment.ts"

# Invalid production cases must exit before the first Docker network mutation.
expect_deploy_failure() {
  local expected_message="$1"
  shift
  if env "${audit_environment[@]}" \
    SWEBUD_ENV_FILE="$AUDIT_ENV" \
    SWEBUD_MODE=prod \
    "$@" \
    "$SCRIPT_DIR/deploy.sh" >"$FAILURE_OUTPUT" 2>&1; then
    echo "Production deploy unexpectedly accepted an invalid configuration." >&2
    exit 1
  fi
  grep -q "$expected_message" "$FAILURE_OUTPUT"
  if grep -Eq 'docker network|Creating|Starting|Running' "$FAILURE_OUTPUT"; then
    echo "Invalid production configuration reached a Docker mutation." >&2
    exit 1
  fi
}

expect_deploy_failure 'HTTPS origins only' \
  FRONTEND_ORIGIN='https://swebudd.example,http://insecure.example'
expect_deploy_failure 'at least 32 characters' \
  JWT_SECRET=too-short
expect_deploy_failure 'CLOUDFLARE_TURNSTILE_SECRET_KEY is required' \
  CLOUDFLARE_TURNSTILE_SECRET_KEY=
expect_deploy_failure 'production mail service' \
  SMTP_HOST=LOCALHOST
expect_deploy_failure 'verify TLS certificates' \
  SMTP_TLS_REJECT_UNAUTHORIZED=false
expect_deploy_failure 'JWT_SECRET, JWT_REFRESH_SECRET, and ADMIN_JWT_SECRET must all differ' \
  ADMIN_JWT_SECRET=audit-access-secret-with-more-than-32-characters
expect_deploy_failure 'database passwords must all differ' \
  "DATABASE_BACKUP_PASSWORD=$audit_runtime_password"
expect_deploy_failure 'DATABASE_BACKUP_URL must authenticate as' \
  "DATABASE_BACKUP_URL=$audit_wrong_role_url"
expect_deploy_failure 'BACKUP_S3_URI is required' \
  BACKUP_ALLOW_LOCAL_ONLY=false \
  BACKUP_S3_URI=
expect_deploy_failure 'POSTGRES_HELPER_IMAGE must use an immutable' \
  POSTGRES_HELPER_IMAGE=postgres:16-alpine
expect_deploy_failure 'must be separate from MEDIA_S3_BUCKET' \
  MEDIA_QUARANTINE_S3_BUCKET=audit-public-media
expect_deploy_failure "nonempty MEDIA_S3_PREFIX must end in '/'" \
  MEDIA_S3_PREFIX=production
expect_deploy_failure 'must exceed MEDIA_MULTIPART_COMPLETE_TIMEOUT_MS' \
  MEDIA_UPLOAD_COMPLETION_STALE_SECONDS=60 \
  MEDIA_MULTIPART_COMPLETE_TIMEOUT_MS=120000
expect_deploy_failure 'CLAMAV_IMAGE must use an immutable' \
  CLAMAV_IMAGE=clamav/clamav:stable

# Render must keep dashboard-managed secrets out of source configuration.
for key in \
  ADMIN_JWT_SECRET \
  CLOUDFLARE_TURNSTILE_SECRET_KEY \
  MEDIA_S3_BUCKET \
  MEDIA_QUARANTINE_S3_BUCKET \
  MEDIA_PUBLIC_BASE_URL \
  MEDIA_CLAMD_TCP_HOST \
  AWS_S3_ENDPOINT \
  AWS_ACCESS_KEY_ID \
  AWS_SECRET_ACCESS_KEY \
  SMTP_HOST \
  SMTP_USER \
  SMTP_PASS \
  MAIL_FROM
do
  grep -A1 -- "- key: $key" "$SCRIPT_DIR/../render.yaml" | grep -q 'sync: false'
done
grep -A1 -- '- key: MEDIA_UPLOAD_WORKER_ENABLED' "$SCRIPT_DIR/../render.yaml" |
  grep -q 'value: "true"'
grep -A1 -- '- key: MEDIA_LEGACY_PROXY_UPLOADS_ENABLED' "$SCRIPT_DIR/../render.yaml" |
  grep -q 'value: "false"'
grep -A1 -- '- key: MEDIA_MALWARE_SCANNER' "$SCRIPT_DIR/../render.yaml" |
  grep -q 'value: clamd-tcp'
grep -A1 -- '- key: MEDIA_CLAMD_TRUSTED_NETWORK' "$SCRIPT_DIR/../render.yaml" |
  grep -q 'value: "true"'
grep -A1 -- '- key: ADMIN_JWT_ISSUER' "$SCRIPT_DIR/../render.yaml" |
  grep -q 'value: swebudd-admin'
grep -A1 -- '- key: ADMIN_JWT_AUDIENCE' "$SCRIPT_DIR/../render.yaml" |
  grep -q 'value: swebudd-admin-moderation'
grep -A1 -- '- key: FRONTEND_ORIGIN' "$SCRIPT_DIR/../render.yaml" |
  grep -q 'value: https://swebudd.com'
grep -q '^    healthCheckPath: /health/ready$' "$SCRIPT_DIR/../render.yaml"
grep -q '^    autoDeployTrigger: checksPass$' "$SCRIPT_DIR/../render.yaml"
grep -q '^    runtime: docker$' "$SCRIPT_DIR/../render.yaml"
grep -q '^    dockerfilePath: ./Dockerfile$' "$SCRIPT_DIR/../render.yaml"

echo "Backend deployment security audit passed."
