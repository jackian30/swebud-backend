#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ "$(uname -s)" == "Linux" ]] || {
  echo "deployment/deploy.sh supports Linux hosts only." >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SWEBUD_ENV_FILE:-$SCRIPT_DIR/.env}"
PROJECT="${COMPOSE_PROJECT_NAME:-swebud}"
SECRET_DIR="$SCRIPT_DIR/.secrets"
STATE_DIR="$SCRIPT_DIR/.deployment-state"

if [[ -L "$ENV_FILE" ]]; then
  echo "Environment file cannot be a symbolic link: $ENV_FILE" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
  echo "Created $ENV_FILE; missing local secrets will be generated."
fi
chmod 0600 "$ENV_FILE"

env_value() {
  local key="$1"
  local fallback="${2:-}"
  local value
  value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -1)"
  printf '%s' "${value:-$fallback}"
}

# Exported variables take precedence over --env-file in Compose. Every
# validation and secret file below therefore uses the same effective value.
resolved_value() {
  local key="$1"
  local fallback="${2:-}"
  if [[ -v "$key" ]]; then
    printf '%s' "${!key}"
  else
    env_value "$key" "$fallback"
  fi
}

set_env_value() {
  local key="$1"
  local value="$2"
  local temporary
  [[ "$value" != *$'\n'* ]] || {
    echo "Refusing to write a multiline value for $key." >&2
    exit 1
  }
  temporary="$(mktemp "$(dirname "$ENV_FILE")/.swebudd-env.XXXXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$temporary"
  chmod 0600 "$temporary"
  mv -- "$temporary" "$ENV_FILE"
}

generate_if_missing() {
  local key="$1"
  local value="$2"
  if [[ -z "$(env_value "$key")" && ! -v "$key" ]]; then
    set_env_value "$key" "$value"
  fi
}

generate_if_missing POSTGRES_PASSWORD "$(openssl rand -hex 32)"
generate_if_missing DATABASE_RUNTIME_USER swebud_runtime
generate_if_missing DATABASE_ADMIN_READONLY_USER swebud_admin_readonly
generate_if_missing DATABASE_BACKUP_USER swebud_backup
generate_if_missing DATABASE_RUNTIME_PASSWORD "$(openssl rand -hex 32)"
generate_if_missing DATABASE_ADMIN_READONLY_PASSWORD "$(openssl rand -hex 32)"
generate_if_missing DATABASE_BACKUP_PASSWORD "$(openssl rand -hex 32)"

if [[ -z "$(env_value DIRECT_URL)" && ! -v DIRECT_URL ]]; then
  set_env_value DIRECT_URL \
    "postgresql://$(env_value POSTGRES_USER swebud):$(env_value POSTGRES_PASSWORD)@postgres:5432/$(env_value POSTGRES_DB swebud)?schema=public"
fi

construct_local_role_url() {
  local role="$1"
  local password="$2"
  printf 'postgresql://%s:%s@postgres:5432/%s?schema=public' \
    "$role" \
    "$password" \
    "$(resolved_value POSTGRES_DB swebud)"
}

local_direct_url="postgresql://$(resolved_value POSTGRES_USER swebud):$(resolved_value POSTGRES_PASSWORD)@postgres:5432/$(resolved_value POSTGRES_DB swebud)?schema=public"
if [[ "$(resolved_value DIRECT_URL)" == "$local_direct_url" ]]; then
  if [[ -z "$(env_value DATABASE_URL)" && ! -v DATABASE_URL ]]; then
    set_env_value DATABASE_URL "$(
      construct_local_role_url \
        "$(resolved_value DATABASE_RUNTIME_USER swebud_runtime)" \
        "$(resolved_value DATABASE_RUNTIME_PASSWORD)"
    )"
  fi
  if [[ -z "$(env_value DATABASE_ADMIN_READONLY_URL)" && ! -v DATABASE_ADMIN_READONLY_URL ]]; then
    set_env_value DATABASE_ADMIN_READONLY_URL "$(
      construct_local_role_url \
        "$(resolved_value DATABASE_ADMIN_READONLY_USER swebud_admin_readonly)" \
        "$(resolved_value DATABASE_ADMIN_READONLY_PASSWORD)"
    )"
  fi
  if [[ -z "$(env_value DATABASE_BACKUP_URL)" && ! -v DATABASE_BACKUP_URL ]]; then
    set_env_value DATABASE_BACKUP_URL "$(
      construct_local_role_url \
        "$(resolved_value DATABASE_BACKUP_USER swebud_backup)" \
        "$(resolved_value DATABASE_BACKUP_PASSWORD)"
    )"
  fi
fi

if [[ -z "$(env_value JWT_SECRET)" && ! -v JWT_SECRET ]]; then
  set_env_value JWT_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
fi
if [[ -z "$(env_value JWT_REFRESH_SECRET)" && ! -v JWT_REFRESH_SECRET ]]; then
  set_env_value JWT_REFRESH_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
fi
if [[ -z "$(env_value ADMIN_JWT_SECRET)" && ! -v ADMIN_JWT_SECRET ]]; then
  set_env_value ADMIN_JWT_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
fi

require_value() {
  local key="$1"
  if [[ -z "$(resolved_value "$key")" ]]; then
    echo "$key is required in $ENV_FILE or the process environment." >&2
    exit 1
  fi
}

reject_known_secret() {
  local key="$1"
  local value
  value="$(resolved_value "$key")"
  case "${value,,}" in
    ""|password|change-me|change-me-too|change-me-in-production|swebud|dev-jwt-secret-change-me|dev-refresh-secret-change-me|local-admin-moderation-secret-not-for-production|your-*|example-*|test-*|*placeholder*)
      echo "$key still uses an empty, example, or known default value." >&2
      exit 1
      ;;
  esac
}

require_secret_length() {
  local key="$1"
  local value
  value="$(resolved_value "$key")"
  if (( ${#value} < 32 )); then
    echo "$key must contain at least 32 characters." >&2
    exit 1
  fi
}

validate_database_role() {
  local key="$1"
  local value
  value="$(resolved_value "$key")"
  if [[ ! "$value" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
    echo "$key must be a valid unquoted PostgreSQL role identifier." >&2
    exit 1
  fi
}

validate_database_password() {
  local key="$1"
  local value
  value="$(resolved_value "$key")"
  require_secret_length "$key"
  if [[ ! "$value" =~ ^[A-Za-z0-9._~-]+$ ]]; then
    echo "$key must use URL-safe unreserved characters so generated URLs are unambiguous." >&2
    exit 1
  fi
}

validate_admin_jwt_identifier() {
  local key="$1"
  local value
  value="$(resolved_value "$key")"
  if [[ ! "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$ ]]; then
    echo "$key must be a 3-128 character URI-safe identifier." >&2
    exit 1
  fi
}

require_database_url_role() {
  local key="$1"
  local expected_role="$2"
  local value
  value="$(resolved_value "$key")"
  case "$value" in
    postgresql://"$expected_role":*|postgres://"$expected_role":*) ;;
    *)
      echo "$key must authenticate as the $expected_role role." >&2
      exit 1
      ;;
  esac
}

validate_https_origin_list() {
  local key="$1"
  local value origin authority host lower_host
  value="$(resolved_value "$key")"
  [[ -z "$value" ]] && return 0

  IFS=',' read -r -a origins <<< "$value"
  for origin in "${origins[@]}"; do
    if [[ ! "$origin" =~ ^https://[^/?#]+$ || "$origin" == *"@"* ]]; then
      echo "Production $key must contain HTTPS origins only." >&2
      exit 1
    fi

    authority="${origin#https://}"
    if [[ "$authority" == \[* ]]; then
      host="${authority%%]*}"
      host="${host#[}"
    else
      host="${authority%%:*}"
    fi
    lower_host="${host,,}"
    case "$lower_host" in
      localhost|*.localhost|*.local|0.0.0.0|127.*|10.*|169.254.*|192.168.*|::1|fc*|fd*|fe80:*)
        echo "Production $key cannot contain localhost or private-network origins." >&2
        exit 1
        ;;
    esac
    if [[ "$lower_host" =~ ^172\.(1[6-9]|2[0-9]|3[01])\. ||
          "$lower_host" =~ ^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\. ]]; then
      echo "Production $key cannot contain localhost or private-network origins." >&2
      exit 1
    fi
  done
}

validate_failure_hook() {
  local hook
  hook="$(resolved_value FAILURE_ALERT_HOOK)"
  [[ "$hook" == /* && -f "$hook" && -x "$hook" && ! -L "$hook" ]] || {
    echo "Production FAILURE_ALERT_HOOK must be an absolute executable, non-symlink file." >&2
    exit 1
  }
}

validate_no_symlink_components() {
  local path="$1"
  local current="/"
  local remainder="${path#/}"
  local component

  IFS='/' read -r -a path_components <<< "$remainder"
  for component in "${path_components[@]}"; do
    [[ -n "$component" ]] || continue
    current="${current%/}/$component"
    [[ ! -L "$current" ]] || {
      echo "Backup signing key path cannot contain a symbolic-link component: $current" >&2
      exit 1
    }
  done
}

validate_backup_signing_private_key() {
  local path permissions key_description
  path="$(resolved_value BACKUP_SIGNING_PRIVATE_KEY_FILE)"
  validate_no_symlink_components "$path"
  [[ "$path" == /* && -f "$path" && ! -L "$path" ]] || {
    echo "Production BACKUP_SIGNING_PRIVATE_KEY_FILE must be an absolute, non-symlink regular file." >&2
    exit 1
  }
  [[ "$(stat -c '%u' "$path")" == "$(id -u)" ]] || {
    echo "Production backup signing private key must be owned by the deployment account." >&2
    exit 1
  }
  permissions="$(stat -c '%a' "$path")"
  (( (8#$permissions & 077) == 0 )) || {
    echo "Production backup signing private key cannot be accessible by group or other." >&2
    exit 1
  }
  key_description="$(openssl pkey -in "$path" -text -noout 2>/dev/null | head -n 1)"
  [[ "$key_description" == "ED25519 Private-Key:" ]] || {
    echo "Production backup signing private key must be Ed25519." >&2
    exit 1
  }
}

require_digest_image() {
  local key="$1"
  local value
  value="$(resolved_value "$key")"
  [[ "$value" =~ @sha256:[a-f0-9]{64}$ ]] || {
    echo "Production $key must use an immutable @sha256 image digest." >&2
    exit 1
  }
}

require_integer_range() {
  local key="$1"
  local minimum="$2"
  local maximum="$3"
  local value
  value="$(resolved_value "$key")"
  [[ "$value" =~ ^[0-9]+$ ]] || {
    echo "$key must be an integer between $minimum and $maximum." >&2
    exit 1
  }
  (( value >= minimum && value <= maximum )) || {
    echo "$key must be an integer between $minimum and $maximum." >&2
    exit 1
  }
}

validate_production_media() {
  local public_bucket quarantine_bucket public_prefix public_base s3_endpoint
  [[ "$(resolved_value MEDIA_STORAGE_DRIVER)" == "s3" ]] || {
    echo "Production MEDIA_STORAGE_DRIVER must be s3." >&2
    exit 1
  }
  for key in \
    MEDIA_S3_BUCKET MEDIA_QUARANTINE_S3_BUCKET MEDIA_PUBLIC_BASE_URL AWS_REGION
  do
    require_value "$key"
  done
  public_bucket="$(resolved_value MEDIA_S3_BUCKET)"
  quarantine_bucket="$(resolved_value MEDIA_QUARANTINE_S3_BUCKET)"
  for bucket_key in MEDIA_S3_BUCKET MEDIA_QUARANTINE_S3_BUCKET; do
    bucket_value="$(resolved_value "$bucket_key")"
    [[ "$bucket_value" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || {
      echo "$bucket_key must be a valid lowercase S3 bucket name." >&2
      exit 1
    }
  done
  [[ "$public_bucket" != "$quarantine_bucket" ]] || {
    echo "MEDIA_QUARANTINE_S3_BUCKET must be separate from MEDIA_S3_BUCKET." >&2
    exit 1
  }
  public_prefix="$(resolved_value MEDIA_S3_PREFIX)"
  case "$public_prefix" in
    /*|*'..'*)
      echo "MEDIA_S3_PREFIX must be relative and cannot contain '..'." >&2
      exit 1
      ;;
  esac
  if LC_ALL=C grep -q '[[:cntrl:]]' < <(printf '%s' "$public_prefix"); then
    echo "MEDIA_S3_PREFIX cannot contain control characters." >&2
    exit 1
  fi
  [[ -z "$public_prefix" || "$public_prefix" == */ ]] || {
    echo "A nonempty MEDIA_S3_PREFIX must end in '/'." >&2
    exit 1
  }
  public_base="$(resolved_value MEDIA_PUBLIC_BASE_URL)"
  [[ "$public_base" =~ ^https://[^[:space:]@/?#]+(/[^[:space:]]*)?$ ]] || {
    echo "MEDIA_PUBLIC_BASE_URL must be an HTTPS URL without credentials." >&2
    exit 1
  }
  s3_endpoint="$(resolved_value AWS_S3_ENDPOINT)"
  [[ -z "$s3_endpoint" || "$s3_endpoint" =~ ^https://[^[:space:]@/?#]+(/[^[:space:]]*)?$ ]] || {
    echo "AWS_S3_ENDPOINT must be an HTTPS URL without credentials when set." >&2
    exit 1
  }
  if [[ -n "$(resolved_value AWS_ACCESS_KEY_ID)" ||
        -n "$(resolved_value AWS_SECRET_ACCESS_KEY)" ||
        -n "$(resolved_value AWS_SESSION_TOKEN)" ]]; then
    require_value AWS_ACCESS_KEY_ID
    require_value AWS_SECRET_ACCESS_KEY
  fi

  require_integer_range MEDIA_UPLOAD_MAX_ACTIVE_PER_USER 1 20
  require_integer_range MEDIA_UPLOAD_ROLLING_QUOTA_BYTES 1 2147483647
  require_integer_range MEDIA_UPLOAD_ROLLING_QUOTA_HOURS 1 168
  require_integer_range MEDIA_UPLOAD_PART_BYTES 5242880 104857600
  require_integer_range MEDIA_UPLOAD_SESSION_TTL_SECONDS 300 86400
  require_integer_range MEDIA_UPLOAD_URL_TTL_SECONDS 60 900
  require_integer_range MEDIA_UPLOAD_WORKER_CONCURRENCY 1 8
  require_integer_range MEDIA_UPLOAD_JOB_MAX_ATTEMPTS 1 10
  require_integer_range MEDIA_UPLOAD_JOB_LEASE_SECONDS 30 1800
  require_integer_range MEDIA_UPLOAD_WORKER_POLL_MS 250 60000
  require_integer_range MEDIA_S3_REQUEST_TIMEOUT_MS 1000 120000
  require_integer_range MEDIA_S3_DOWNLOAD_TIMEOUT_MS 10000 900000
  require_integer_range MEDIA_MULTIPART_COMPLETE_TIMEOUT_MS 10000 900000
  require_integer_range MEDIA_UPLOAD_COMPLETION_STALE_SECONDS 60 3600
  require_integer_range MEDIA_QUARANTINE_CLEANUP_TOMBSTONE_SECONDS 300 86400
  require_integer_range MEDIA_PUBLISH_TIMEOUT_MS 10000 900000
  require_integer_range MEDIA_PUBLISH_CLEANUP_GRACE_SECONDS 300 86400
  require_integer_range MEDIA_PUBLISH_CLEANUP_TOMBSTONE_SECONDS 60 3600
  require_integer_range MEDIA_PROCESSING_CONCURRENCY 1 8
  require_integer_range MEDIA_PROCESSING_MAX_QUEUE 0 100
  require_integer_range MEDIA_PROCESSING_STALE_TEMP_SECONDS 3600 604800
  require_integer_range MEDIA_PROCESSING_STALE_CLEANUP_LIMIT 1 500
  require_integer_range MEDIA_MALWARE_SCAN_TIMEOUT_MS 1000 300000

  (( $(resolved_value MEDIA_PUBLISH_CLEANUP_GRACE_SECONDS) >
     $(resolved_value MEDIA_UPLOAD_JOB_LEASE_SECONDS) &&
     $(resolved_value MEDIA_PUBLISH_CLEANUP_GRACE_SECONDS) * 1000 >
     $(resolved_value MEDIA_PUBLISH_TIMEOUT_MS) )) || {
    echo "MEDIA_PUBLISH_CLEANUP_GRACE_SECONDS must exceed both the worker lease and public publish timeout." >&2
    exit 1
  }
  (( $(resolved_value MEDIA_UPLOAD_COMPLETION_STALE_SECONDS) * 1000 >
     $(resolved_value MEDIA_MULTIPART_COMPLETE_TIMEOUT_MS) )) || {
    echo "MEDIA_UPLOAD_COMPLETION_STALE_SECONDS must exceed MEDIA_MULTIPART_COMPLETE_TIMEOUT_MS." >&2
    exit 1
  }
  (( $(resolved_value MEDIA_QUARANTINE_CLEANUP_TOMBSTONE_SECONDS) >
     $(resolved_value MEDIA_UPLOAD_URL_TTL_SECONDS) &&
     $(resolved_value MEDIA_QUARANTINE_CLEANUP_TOMBSTONE_SECONDS) >
     $(resolved_value MEDIA_UPLOAD_COMPLETION_STALE_SECONDS) &&
     $(resolved_value MEDIA_QUARANTINE_CLEANUP_TOMBSTONE_SECONDS) * 1000 >
     $(resolved_value MEDIA_MULTIPART_COMPLETE_TIMEOUT_MS) &&
     $(resolved_value MEDIA_QUARANTINE_CLEANUP_TOMBSTONE_SECONDS) * 1000 >
     $(resolved_value MEDIA_S3_REQUEST_TIMEOUT_MS) )) || {
    echo "MEDIA_QUARANTINE_CLEANUP_TOMBSTONE_SECONDS must exceed upload URL, completion, multipart, and S3 request timeouts." >&2
    exit 1
  }
}

for key in \
  POSTGRES_PASSWORD DATABASE_URL DIRECT_URL \
  DATABASE_RUNTIME_USER DATABASE_RUNTIME_PASSWORD \
  DATABASE_ADMIN_READONLY_USER DATABASE_ADMIN_READONLY_PASSWORD DATABASE_ADMIN_READONLY_URL \
  DATABASE_BACKUP_USER DATABASE_BACKUP_PASSWORD DATABASE_BACKUP_URL \
  JWT_SECRET JWT_REFRESH_SECRET ADMIN_JWT_SECRET ADMIN_JWT_ISSUER ADMIN_JWT_AUDIENCE \
  FRONTEND_ORIGIN
do
  require_value "$key"
done

for role_key in DATABASE_RUNTIME_USER DATABASE_ADMIN_READONLY_USER DATABASE_BACKUP_USER; do
  validate_database_role "$role_key"
done
for password_key in \
  DATABASE_RUNTIME_PASSWORD \
  DATABASE_ADMIN_READONLY_PASSWORD \
  DATABASE_BACKUP_PASSWORD
do
  validate_database_password "$password_key"
done

runtime_role="$(resolved_value DATABASE_RUNTIME_USER)"
readonly_role="$(resolved_value DATABASE_ADMIN_READONLY_USER)"
backup_role="$(resolved_value DATABASE_BACKUP_USER)"
owner_role="$(resolved_value POSTGRES_USER swebud)"
if [[ "$runtime_role" == "$readonly_role" ||
      "$runtime_role" == "$backup_role" ||
      "$readonly_role" == "$backup_role" ||
      "$runtime_role" == "$owner_role" ||
      "$readonly_role" == "$owner_role" ||
      "$backup_role" == "$owner_role" ]]; then
  echo "Owner, runtime, admin read-only, and backup database roles must all be different." >&2
  exit 1
fi

database_passwords=(
  "$(resolved_value POSTGRES_PASSWORD)"
  "$(resolved_value DATABASE_RUNTIME_PASSWORD)"
  "$(resolved_value DATABASE_ADMIN_READONLY_PASSWORD)"
  "$(resolved_value DATABASE_BACKUP_PASSWORD)"
)
for (( left = 0; left < ${#database_passwords[@]}; left += 1 )); do
  for (( right = left + 1; right < ${#database_passwords[@]}; right += 1 )); do
    if [[ "${database_passwords[$left]}" == "${database_passwords[$right]}" ]]; then
      echo "Owner, runtime, admin read-only, and backup database passwords must all differ." >&2
      exit 1
    fi
  done
done

database_urls=(
  "$(resolved_value DIRECT_URL)"
  "$(resolved_value DATABASE_URL)"
  "$(resolved_value DATABASE_ADMIN_READONLY_URL)"
  "$(resolved_value DATABASE_BACKUP_URL)"
)
for (( left = 0; left < ${#database_urls[@]}; left += 1 )); do
  for (( right = left + 1; right < ${#database_urls[@]}; right += 1 )); do
    if [[ "${database_urls[$left]}" == "${database_urls[$right]}" ]]; then
      echo "Owner, runtime, admin read-only, and backup database URLs must all differ." >&2
      exit 1
    fi
  done
done
require_database_url_role DATABASE_URL "$runtime_role"
require_database_url_role DATABASE_ADMIN_READONLY_URL "$readonly_role"
require_database_url_role DATABASE_BACKUP_URL "$backup_role"

validate_admin_jwt_identifier ADMIN_JWT_ISSUER
validate_admin_jwt_identifier ADMIN_JWT_AUDIENCE
if [[ "$(resolved_value ADMIN_JWT_ISSUER)" == "$(resolved_value ADMIN_JWT_AUDIENCE)" ]]; then
  echo "ADMIN_JWT_ISSUER and ADMIN_JWT_AUDIENCE must be different." >&2
  exit 1
fi
jwt_secrets=(
  "$(resolved_value JWT_SECRET)"
  "$(resolved_value JWT_REFRESH_SECRET)"
  "$(resolved_value ADMIN_JWT_SECRET)"
)
for (( left = 0; left < ${#jwt_secrets[@]}; left += 1 )); do
  for (( right = left + 1; right < ${#jwt_secrets[@]}; right += 1 )); do
    if [[ "${jwt_secrets[$left]}" == "${jwt_secrets[$right]}" ]]; then
      echo "JWT_SECRET, JWT_REFRESH_SECRET, and ADMIN_JWT_SECRET must all differ." >&2
      exit 1
    fi
  done
done

MODE="${SWEBUD_MODE:-$(env_value SWEBUD_MODE dev)}"
case "$MODE" in
  dev|local|development)
    COMPOSE_FILE="$SCRIPT_DIR/docker-compose-dev.yml"
    MODE_LABEL="development"
    export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
    export LOCAL_GID="${LOCAL_GID:-$(id -g)}"
    ;;
  prod|production)
    COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
    MODE_LABEL="production"
    require_value CLOUDFLARE_TURNSTILE_SECRET_KEY
    require_value BACKUP_AGE_RECIPIENT
    require_value BACKUP_SIGNING_PRIVATE_KEY_FILE
    require_value BACKUP_OUTPUT_DIR
    require_value FAILURE_ALERT_HOOK
    for key in \
      POSTGRES_PASSWORD \
      DATABASE_RUNTIME_PASSWORD \
      DATABASE_ADMIN_READONLY_PASSWORD \
      DATABASE_BACKUP_PASSWORD \
      JWT_SECRET \
      JWT_REFRESH_SECRET \
      ADMIN_JWT_SECRET \
      CLOUDFLARE_TURNSTILE_SECRET_KEY
    do
      reject_known_secret "$key"
    done
    require_secret_length POSTGRES_PASSWORD
    require_secret_length JWT_SECRET
    require_secret_length JWT_REFRESH_SECRET
    require_secret_length ADMIN_JWT_SECRET
    require_secret_length CLOUDFLARE_TURNSTILE_SECRET_KEY
    validate_https_origin_list FRONTEND_ORIGIN
    validate_https_origin_list ADMIN_ORIGIN
    if [[ "$(resolved_value ALLOW_LOCAL_ORIGINS false)" != "false" ]]; then
      echo "Production ALLOW_LOCAL_ORIGINS must be false." >&2
      exit 1
    fi
    if [[ "$(resolved_value NATIVE_AUTH_ENABLED false)" == "true" ]]; then
      require_value NATIVE_APP_ORIGIN
      case "$(resolved_value NATIVE_APP_ORIGIN)" in
        https://localhost|capacitor://localhost) ;;
        *)
          echo "Production NATIVE_APP_ORIGIN must be an exact trusted Capacitor origin." >&2
          exit 1
          ;;
      esac
    fi
    for key in SMTP_HOST MAIL_FROM; do
      require_value "$key"
    done
    smtp_host="$(resolved_value SMTP_HOST)"
    case "${smtp_host,,}" in
      mailhog|localhost|127.*|0.0.0.0|::1|'[::1]')
        echo "Production SMTP_HOST must use a production mail service." >&2
        exit 1
        ;;
    esac
    if [[ "$(resolved_value SMTP_IGNORE_TLS false)" != "false" ||
          "$(resolved_value SMTP_REQUIRE_TLS true)" != "true" ]]; then
      echo "Production SMTP must require TLS and must not ignore TLS." >&2
      exit 1
    fi
    if [[ "$(resolved_value SMTP_TLS_REJECT_UNAUTHORIZED true)" != "true" ]]; then
      echo "Production SMTP must verify TLS certificates." >&2
      exit 1
    fi
    if [[ "$(resolved_value MAIL_FROM)" =~ [Ll][Oo][Cc][Aa][Ll][Hh][Oo][Ss][Tt] ]]; then
      echo "Production MAIL_FROM must use a verified non-localhost sender." >&2
      exit 1
    fi
    if [[ "$(resolved_value BACKUP_ALLOW_LOCAL_ONLY false)" != "true" ]]; then
      require_value BACKUP_S3_URI
      if [[ "$(resolved_value BACKUP_OFFSITE_RETENTION_CONFIRMED false)" != "true" ]]; then
        echo "Production offsite retention must be externally enforced and acknowledged." >&2
        exit 1
      fi
    fi
    [[ "$(resolved_value BACKUP_OUTPUT_DIR)" == /* ]] || {
      echo "Production BACKUP_OUTPUT_DIR must be absolute." >&2
      exit 1
    }
    validate_backup_signing_private_key
    validate_failure_hook
    validate_production_media
    for image_key in \
      POSTGRES_IMAGE POSTGRES_HELPER_IMAGE MEDIA_HELPER_IMAGE CLAMAV_IMAGE
    do
      require_digest_image "$image_key"
    done
    ;;
  *)
    echo "Unknown SWEBUD_MODE '$MODE'. Use dev or prod." >&2
    exit 1
    ;;
esac

if [[ -e "$SECRET_DIR" && ( ! -d "$SECRET_DIR" || -L "$SECRET_DIR" ) ]]; then
  echo "Secret path must be a non-symlink directory: $SECRET_DIR" >&2
  exit 1
fi
mkdir -p "$SECRET_DIR"
chmod 0700 "$SECRET_DIR"

write_secret_file() {
  local destination="$1"
  local value="$2"
  local temporary
  [[ ! -L "$destination" ]] || {
    echo "Secret destination cannot be a symbolic link: $destination" >&2
    exit 1
  }
  [[ "$value" != *$'\n'* && -n "$value" ]] || {
    echo "Secret values must be non-empty single lines." >&2
    exit 1
  }
  temporary="$(mktemp "$SECRET_DIR/.secret.XXXXXXXX")"
  printf '%s' "$value" > "$temporary"
  chmod 0600 "$temporary"
  mv -- "$temporary" "$destination"
}

write_secret_file "$SECRET_DIR/direct-url" "$(resolved_value DIRECT_URL)"
write_secret_file "$SECRET_DIR/runtime-password" "$(resolved_value DATABASE_RUNTIME_PASSWORD)"
write_secret_file "$SECRET_DIR/readonly-password" "$(resolved_value DATABASE_ADMIN_READONLY_PASSWORD)"
write_secret_file "$SECRET_DIR/backup-password" "$(resolved_value DATABASE_BACKUP_PASSWORD)"

export DATABASE_OWNER_URL_SECRET_FILE="$SECRET_DIR/direct-url"
export DATABASE_RUNTIME_PASSWORD_SECRET_FILE="$SECRET_DIR/runtime-password"
export DATABASE_ADMIN_READONLY_PASSWORD_SECRET_FILE="$SECRET_DIR/readonly-password"
export DATABASE_BACKUP_PASSWORD_SECRET_FILE="$SECRET_DIR/backup-password"

NETWORK="$(resolved_value SWEBUD_NETWORK swebud)"
docker network inspect "$NETWORK" >/dev/null 2>&1 ||
  docker network create "$NETWORK" >/dev/null

compose=(
  docker compose
  -p "$PROJECT"
  --env-file "$ENV_FILE"
  -f "$COMPOSE_FILE"
)

failure_hook="$(resolved_value FAILURE_ALERT_HOOK)"
deploy_complete=false
one_shot_services=(db-roles)
[[ "$MODE_LABEL" == "development" ]] || one_shot_services+=(migrate)

send_failure_alert() {
  local exit_code="$1"
  [[ -n "$failure_hook" && -x "$failure_hook" && ! -L "$failure_hook" ]] || return 0
  SWEBUDD_ALERT_EVENT="deployment_failed" \
  SWEBUDD_ALERT_EXIT_CODE="$exit_code" \
  SWEBUDD_ALERT_PROJECT="$PROJECT" \
  SWEBUDD_ALERT_MODE="$MODE_LABEL" \
    "$failure_hook" || {
      echo "Failure alert hook also failed." >&2
      return 1
    }
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  "${compose[@]}" rm --force --stop "${one_shot_services[@]}" >/dev/null 2>&1 || true
  for temporary_state in \
    "${previous_state_temporary:-}" \
    "${current_state_temporary:-}" \
    "${temporary_database_url:-}"
  do
    case "$temporary_state" in
      "$STATE_DIR"/.previous.*|"$STATE_DIR"/.current.*|"${TMPDIR:-/tmp}"/swebudd-migration-state.*)
        [[ ! -e "$temporary_state" ]] || rm -f -- "$temporary_state"
        ;;
    esac
  done
  if [[ "$exit_code" -ne 0 || "$deploy_complete" != "true" ]]; then
    send_failure_alert "$exit_code" || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

wait_for_service_health() {
  local service="$1"
  local container_id running health
  for _attempt in $(seq 1 120); do
    container_id="$("${compose[@]}" ps -q "$service")"
    if [[ -n "$container_id" ]]; then
      running="$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null || true)"
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || true)"
      if [[ "$running" == "true" && ( "$health" == "healthy" || "$health" == "none" ) ]]; then
        return 0
      fi
    fi
    sleep 1
  done
  echo "$service did not become healthy." >&2
  return 1
}

prior_backend_id="$("${compose[@]}" ps --all -q backend)"
mapfile -t prior_database_volumes < <(
  docker volume ls \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.volume=swebud_postgres_data" \
    --quiet
)
prior_state_present=false
if [[ -n "$prior_backend_id" || ${#prior_database_volumes[@]} -gt 0 ]]; then
  prior_state_present=true
fi

if [[ "$MODE_LABEL" == "production" ]]; then
  initial_deploy="$(resolved_value SWEBUD_INITIAL_DEPLOY false)"
  [[ "$initial_deploy" == "true" || "$initial_deploy" == "false" ]] || {
    echo "SWEBUD_INITIAL_DEPLOY must be true or false." >&2
    exit 1
  }
  if [[ "$prior_state_present" == "false" && "$initial_deploy" != "true" ]]; then
    echo "No prior stack state exists. Set SWEBUD_INITIAL_DEPLOY=true for the first production deploy." >&2
    exit 1
  fi
  if [[ "$prior_state_present" == "true" && "$initial_deploy" == "true" ]]; then
    echo "SWEBUD_INITIAL_DEPLOY=true is forbidden when prior database/backend state exists." >&2
    exit 1
  fi
fi

postgres_container="$("${compose[@]}" ps --all -q postgres)"
if [[ -n "$postgres_container" ]]; then
  "${compose[@]}" start postgres >/dev/null
else
  "${compose[@]}" up -d --no-deps postgres >/dev/null
fi
wait_for_service_health postgres

if [[ "$MODE_LABEL" == "development" ]]; then
  "${compose[@]}" up -d --no-deps mailhog >/dev/null
fi

# One-shot role reconciliation receives every credential through Compose secret
# files and is removed by --rm. No owner URL or role password appears in argv
# or the persistent container configuration.
"${compose[@]}" run --rm --no-deps db-roles

checkpoint_dir="none"
if [[ "$MODE_LABEL" == "production" && "$prior_state_present" == "true" ]]; then
  checkpoint_result="$(mktemp "${TMPDIR:-/tmp}/swebudd-checkpoint.XXXXXXXX")"
  chmod 0600 "$checkpoint_result"
  BACKUP_PURPOSE=pre-migration \
  BACKUP_RESULT_FILE="$checkpoint_result" \
  SWEBUD_MODE=prod \
    "$SCRIPT_DIR/backup.sh"
  checkpoint_dir="$(<"$checkpoint_result")"
  rm -f -- "$checkpoint_result"
  [[ "$checkpoint_dir" == /* && -d "$checkpoint_dir" ]] || {
    echo "Pre-migration checkpoint did not return a valid completed backup path." >&2
    exit 1
  }
fi

if [[ "$MODE_LABEL" == "production" ]]; then
  mkdir -p "$STATE_DIR"
  [[ -d "$STATE_DIR" && ! -L "$STATE_DIR" ]] || {
    echo "Deployment state path must be a non-symlink directory." >&2
    exit 1
  }
  chmod 0700 "$STATE_DIR"

  deploy_id="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 8)"
  export BACKEND_IMAGE="swebud-backend:$deploy_id"
  git_commit="$(git -C "$SCRIPT_DIR/.." rev-parse HEAD 2>/dev/null || printf 'unknown')"

  previous_state_temporary="$(mktemp "$STATE_DIR/.previous.XXXXXXXX")"
  if [[ -f "$STATE_DIR/current.env" && ! -L "$STATE_DIR/current.env" ]]; then
    cp "$STATE_DIR/current.env" "$previous_state_temporary"
  elif [[ -n "$prior_backend_id" ]]; then
    prior_image_id="$(docker inspect --format '{{.Image}}' "$prior_backend_id")"
    prior_image_ref="$(docker inspect --format '{{.Config.Image}}' "$prior_backend_id")"
    {
      echo "format=swebudd-deployment-state-v1"
      echo "deploy_id=pre-state-file"
      echo "deployed_at_utc=unknown"
      echo "project=$PROJECT"
      echo "git_commit=unknown"
      echo "backend_image_ref=$prior_image_ref"
      echo "backend_image_id=$prior_image_id"
      echo "backend_repo_digests=unknown"
      echo "compose_sha256=unknown"
      echo "migration_count=unknown"
      echo "migration_state_sha256=unknown"
      echo "pre_migration_backup_dir=$checkpoint_dir"
    } > "$previous_state_temporary"
  else
    : > "$previous_state_temporary"
  fi
  chmod 0600 "$previous_state_temporary"

  "${compose[@]}" build backend
  built_image_id="$(docker image inspect --format '{{.Id}}' "$BACKEND_IMAGE")"
  built_repo_digests="$(
    docker image inspect --format '{{join .RepoDigests ","}}' "$BACKEND_IMAGE"
  )"
  [[ "$built_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || {
    echo "Built backend image does not have an immutable image ID." >&2
    exit 1
  }

  # The checkpoint is complete before this is allowed to touch schema state.
  if [[ -n "$prior_backend_id" ]] &&
     [[ "$(docker inspect --format '{{.State.Running}}' "$prior_backend_id" 2>/dev/null || true)" == "true" ]]; then
    "${compose[@]}" stop --timeout 60 backend >/dev/null
  fi
  "${compose[@]}" run --rm --no-deps --no-build migrate

  temporary_database_url="$(mktemp "${TMPDIR:-/tmp}/swebudd-migration-state.XXXXXXXX")"
  printf '%s' "$(resolved_value DATABASE_BACKUP_URL)" > "$temporary_database_url"
  chmod 0600 "$temporary_database_url"
  if ! migration_state="$(
    docker run --rm \
      --network "$NETWORK" \
      --read-only \
      --tmpfs /tmp:rw,noexec,nosuid,size=16m,mode=1777 \
      --cap-drop ALL \
      --security-opt no-new-privileges:true \
      --pids-limit 64 \
      --volume "$temporary_database_url:/run/secrets/database-url:ro" \
      --volume "$SCRIPT_DIR/migration-state.sql:/deployment/migration-state.sql:ro" \
      "$(resolved_value POSTGRES_HELPER_IMAGE)" \
      sh -ceu '
        PGDATABASE="$(cat /run/secrets/database-url)"
        export PGDATABASE
        exec psql --no-psqlrc --file /deployment/migration-state.sql
      '
  )"; then
    rm -f -- "$temporary_database_url"
    temporary_database_url=""
    echo "Unable to capture the post-migration database state." >&2
    exit 1
  fi
  rm -f -- "$temporary_database_url"
  temporary_database_url=""
  IFS='|' read -r migration_count migration_md5 migration_extra <<< "$migration_state"
  [[ -z "${migration_extra:-}" &&
     "$migration_count" =~ ^[0-9]+$ &&
     "$migration_md5" =~ ^[a-f0-9]{32}$ ]] || {
    echo "Post-migration database state had an unexpected shape." >&2
    exit 1
  }
  migration_state_sha256="$(printf '%s\n' "$migration_state" | sha256sum | awk '{print $1}')"

  "${compose[@]}" up \
    -d \
    --no-deps \
    --no-build \
    --force-recreate \
    --wait \
    --wait-timeout 180 \
    backend

  deployed_container="$("${compose[@]}" ps -q backend)"
  deployed_image_id="$(docker inspect --format '{{.Image}}' "$deployed_container")"
  [[ "$deployed_image_id" == "$built_image_id" ]] || {
    echo "Running backend image ID does not match the image that was built and audited." >&2
    exit 1
  }

  compose_sha256="$(
    "${compose[@]}" config |
      sha256sum |
      awk '{print $1}'
  )"
  current_state_temporary="$(mktemp "$STATE_DIR/.current.XXXXXXXX")"
  {
    echo "format=swebudd-deployment-state-v1"
    echo "deploy_id=$deploy_id"
    echo "deployed_at_utc=$(date -u +%Y%m%dT%H%M%SZ)"
    echo "project=$PROJECT"
    echo "git_commit=$git_commit"
    echo "backend_image_ref=$BACKEND_IMAGE"
    echo "backend_image_id=$built_image_id"
    echo "backend_repo_digests=${built_repo_digests:-none}"
    echo "compose_sha256=$compose_sha256"
    echo "migration_count=$migration_count"
    echo "migration_state_sha256=$migration_state_sha256"
    echo "pre_migration_backup_dir=$checkpoint_dir"
  } > "$current_state_temporary"
  chmod 0600 "$current_state_temporary"
  mv -- "$current_state_temporary" "$STATE_DIR/current.env"
  if [[ -s "$previous_state_temporary" ]]; then
    mv -- "$previous_state_temporary" "$STATE_DIR/previous.env"
    previous_state_temporary=""
  else
    rm -f -- "$previous_state_temporary"
    previous_state_temporary=""
  fi
else
  "${compose[@]}" up \
    -d \
    --no-deps \
    --build \
    --force-recreate \
    --wait \
    --wait-timeout 180 \
    backend
fi

"${compose[@]}" rm --force --stop "${one_shot_services[@]}" >/dev/null 2>&1 || true
deploy_complete=true

echo "SweBudd stack is ready:"
echo "- Mode:               $MODE_LABEL"
echo "- Backend container:  http://127.0.0.1:$(resolved_value BACKEND_PORT 3002)"
echo "- Allowed frontend:   $(resolved_value FRONTEND_ORIGIN http://localhost:9000)"
if [[ "$MODE_LABEL" == "development" ]]; then
  echo "- MailHog:            http://127.0.0.1:$(resolved_value MAILHOG_UI_PORT 8126)"
  echo "- Container user:     ${LOCAL_UID}:${LOCAL_GID}"
else
  echo "- Pre-migration backup: $checkpoint_dir"
  echo "- Backend image ID:     $built_image_id"
  echo "- Deployment state:     $STATE_DIR/current.env"
fi
echo "- Shared network:     $NETWORK"
echo "- Compose file:       $COMPOSE_FILE"
