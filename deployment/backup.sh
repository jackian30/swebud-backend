#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SWEBUD_ENV_FILE:-$SCRIPT_DIR/.env}"
PROJECT="${COMPOSE_PROJECT_NAME:-swebud}"

if [[ ! -f "$ENV_FILE" || -L "$ENV_FILE" ]]; then
  echo "Environment file must be a regular, non-symlink file: $ENV_FILE" >&2
  exit 1
fi

env_value() {
  local key="$1"
  local fallback="${2:-}"
  local value
  value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -1)"
  printf '%s' "${value:-$fallback}"
}

resolved_value() {
  local key="$1"
  local fallback="${2:-}"
  if [[ -v "$key" ]]; then
    printf '%s' "${!key}"
  else
    env_value "$key" "$fallback"
  fi
}

fail() {
  echo "$*" >&2
  return 1
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 ||
    fail "$command_name is required."
}

require_positive_integer() {
  local variable_name="$1"
  local value="$2"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] ||
    fail "$variable_name must be a positive integer."
}

require_digest_image() {
  local variable_name="$1"
  local image="$2"
  [[ "$image" =~ @sha256:[a-f0-9]{64}$ ]] ||
    fail "$variable_name must use an immutable @sha256 digest in production."
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
    if [[ -L "$current" ]]; then
      fail "Backup path cannot contain a symbolic-link component: $current"
      return 1
    fi
  done
}

validate_private_file() {
  local variable_name="$1"
  local path="$2"
  local permissions

  [[ "$path" == /* ]] ||
    { fail "$variable_name must be an absolute path."; return 1; }
  validate_no_symlink_components "$path" || return 1
  [[ -f "$path" && ! -L "$path" ]] ||
    { fail "$variable_name must reference a non-symlink regular file."; return 1; }
  [[ "$(stat -c '%u' "$path")" == "$(id -u)" ]] ||
    { fail "$variable_name must be owned by the account running the backup."; return 1; }
  permissions="$(stat -c '%a' "$path")"
  (( (8#$permissions & 077) == 0 )) ||
    { fail "$variable_name cannot be readable or writable by group/other."; return 1; }
}

validate_s3_relative_key() {
  local relative_key="$1"
  local path_key="${relative_key%/}"
  local component

  [[ -n "$path_key" && "$path_key" != /* ]] ||
    { fail "S3 media key maps to an empty or absolute archive path."; return 1; }
  if LC_ALL=C grep -q '[[:cntrl:]]' < <(printf '%s' "$path_key"); then
    fail "S3 media keys containing control characters are not supported."
    return 1
  fi
  IFS='/' read -r -a key_components <<< "$path_key"
  for component in "${key_components[@]}"; do
    [[ -n "$component" && "$component" != "." && "$component" != ".." ]] ||
      { fail "S3 media key contains an unsafe path component."; return 1; }
  done
}

validate_failure_hook() {
  local hook="$1"
  [[ -n "$hook" ]] ||
    { fail "FAILURE_ALERT_HOOK is required in production."; return 1; }
  [[ "$hook" == /* ]] ||
    { fail "FAILURE_ALERT_HOOK must be an absolute path."; return 1; }
  [[ -f "$hook" && -x "$hook" && ! -L "$hook" ]] ||
    { fail "FAILURE_ALERT_HOOK must be an executable, non-symlink regular file."; return 1; }
}

mode="$(resolved_value SWEBUD_MODE dev)"
case "$mode" in
  dev|local|development)
    production=false
    compose_file="$SCRIPT_DIR/docker-compose-dev.yml"
    ;;
  prod|production)
    production=true
    compose_file="$SCRIPT_DIR/docker-compose.yml"
    ;;
  *)
    fail "Unknown SWEBUD_MODE '$mode'. Use dev or prod."
    exit 1
    ;;
esac

for command_name in age cmp date docker find git head jq openssl sha256sum stat tar; do
  require_command "$command_name" || exit 1
done

database_backup_url="$(resolved_value DATABASE_BACKUP_URL)"
age_recipient="$(resolved_value BACKUP_AGE_RECIPIENT)"
signing_private_key="$(resolved_value BACKUP_SIGNING_PRIVATE_KEY_FILE)"
network="$(resolved_value SWEBUD_NETWORK swebud)"
media_driver="$(resolved_value MEDIA_STORAGE_DRIVER local)"
output_root="$(resolved_value BACKUP_OUTPUT_DIR)"
offsite_uri="$(resolved_value BACKUP_S3_URI)"
allow_local_only="$(resolved_value BACKUP_ALLOW_LOCAL_ONLY false)"
offsite_retention_confirmed="$(resolved_value BACKUP_OFFSITE_RETENTION_CONFIRMED false)"
retention_days="$(resolved_value BACKUP_RETENTION_DAYS 30)"
rpo_hours="$(resolved_value BACKUP_RPO_HOURS 24)"
rto_hours="$(resolved_value BACKUP_RTO_HOURS 4)"
failure_hook="$(resolved_value FAILURE_ALERT_HOOK)"
backup_purpose="$(resolved_value BACKUP_PURPOSE scheduled)"
postgres_image="$(resolved_value POSTGRES_HELPER_IMAGE 'postgres@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50')"
media_image="$(resolved_value MEDIA_HELPER_IMAGE 'alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc')"

[[ -n "$database_backup_url" ]] ||
  { fail "DATABASE_BACKUP_URL is required; DIRECT_URL is never accepted for backups."; exit 1; }
[[ -n "$age_recipient" ]] ||
  { fail "BACKUP_AGE_RECIPIENT is required."; exit 1; }
[[ -n "$signing_private_key" ]] ||
  { fail "BACKUP_SIGNING_PRIVATE_KEY_FILE is required."; exit 1; }
validate_private_file BACKUP_SIGNING_PRIVATE_KEY_FILE "$signing_private_key" || exit 1
key_description="$(openssl pkey -in "$signing_private_key" -text -noout 2>/dev/null | head -n 1)"
[[ "$key_description" == "ED25519 Private-Key:" ]] ||
  { fail "BACKUP_SIGNING_PRIVATE_KEY_FILE must contain an Ed25519 private key."; exit 1; }
signing_public_key_sha256="$(
  openssl pkey -in "$signing_private_key" -pubout -outform DER |
    sha256sum |
    awk '{print $1}'
)"
[[ "$signing_public_key_sha256" =~ ^[a-f0-9]{64}$ ]] ||
  { fail "Could not derive the signing public-key fingerprint."; exit 1; }
[[ -n "$output_root" && "$output_root" == /* ]] ||
  { fail "BACKUP_OUTPUT_DIR must be an absolute path."; exit 1; }
[[ "$output_root" != "/" ]] ||
  { fail "BACKUP_OUTPUT_DIR cannot be the filesystem root."; exit 1; }
[[ "$media_driver" == "local" || "$media_driver" == "s3" ]] ||
  { fail "MEDIA_STORAGE_DRIVER must be local or s3."; exit 1; }
[[ "$allow_local_only" == "true" || "$allow_local_only" == "false" ]] ||
  { fail "BACKUP_ALLOW_LOCAL_ONLY must be true or false."; exit 1; }
require_positive_integer BACKUP_RETENTION_DAYS "$retention_days" || exit 1
require_positive_integer BACKUP_RPO_HOURS "$rpo_hours" || exit 1
require_positive_integer BACKUP_RTO_HOURS "$rto_hours" || exit 1

case "$backup_purpose" in
  scheduled|manual|pre-migration) ;;
  *)
    fail "BACKUP_PURPOSE must be scheduled, manual, or pre-migration."
    exit 1
    ;;
esac

if [[ "$production" == "true" ]]; then
  require_digest_image POSTGRES_HELPER_IMAGE "$postgres_image" || exit 1
  require_digest_image MEDIA_HELPER_IMAGE "$media_image" || exit 1
  validate_failure_hook "$failure_hook" || exit 1
  if [[ -z "$offsite_uri" && "$allow_local_only" != "true" ]]; then
    fail "Production requires BACKUP_S3_URI unless BACKUP_ALLOW_LOCAL_ONLY=true is explicitly set."
    exit 1
  fi
  if [[ -n "$offsite_uri" && "$offsite_retention_confirmed" != "true" ]]; then
    fail "Set BACKUP_OFFSITE_RETENTION_CONFIRMED=true only after bucket lifecycle/object-lock retention is enforced."
    exit 1
  fi
fi

if [[ -n "$offsite_uri" ]]; then
  [[ "$offsite_uri" =~ ^s3://[^/[:space:]]+(/[^[:space:]]*)?$ ]] ||
    { fail "BACKUP_S3_URI must be an s3:// bucket or prefix without whitespace."; exit 1; }
  require_command aws || exit 1
fi
if [[ "$media_driver" == "s3" ]]; then
  require_command aws || exit 1
  require_command base64 || exit 1
  # AWS SDK/CLI credentials may come from workload identity. Only export
  # explicit .env/process values when present so empty placeholders never
  # suppress the provider credential chain.
  for credential_key in \
    AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  do
    credential_value="$(resolved_value "$credential_key")"
    if [[ -n "$credential_value" ]]; then
      printf -v "$credential_key" '%s' "$credential_value"
      export "$credential_key"
    fi
  done
  media_public_bucket="$(resolved_value MEDIA_S3_BUCKET)"
  media_public_prefix="$(resolved_value MEDIA_S3_PREFIX)"
  [[ "$media_public_bucket" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ||
    { fail "MEDIA_S3_BUCKET is required and contains unsupported characters."; exit 1; }
  case "$media_public_prefix" in
    /*|*'..'*)
      fail "MEDIA_S3_PREFIX must be relative and cannot contain '..'."
      exit 1
      ;;
  esac
  if LC_ALL=C grep -q '[[:cntrl:]]' < <(printf '%s' "$media_public_prefix"); then
    fail "MEDIA_S3_PREFIX cannot contain control characters."
    exit 1
  fi
  [[ -z "$media_public_prefix" || "$media_public_prefix" == */ ]] ||
    { fail "A nonempty MEDIA_S3_PREFIX must end in '/'."; exit 1; }
fi

validate_no_symlink_components "$output_root" || exit 1
mkdir -p -- "$output_root"
validate_no_symlink_components "$output_root" || exit 1
[[ -d "$output_root" && ! -L "$output_root" ]] ||
  { fail "BACKUP_OUTPUT_DIR must be a non-symlink directory."; exit 1; }
chmod 0700 "$output_root"
[[ "$(stat -c '%a' "$output_root")" == "700" ]] ||
  { fail "BACKUP_OUTPUT_DIR must have mode 0700."; exit 1; }
[[ "$(stat -c '%u' "$output_root")" == "$(id -u)" ]] ||
  { fail "BACKUP_OUTPUT_DIR must be owned by the account running the backup."; exit 1; }

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
created_epoch="$(date -u +%s)"
backup_id="$(openssl rand -hex 16)"
backup_name="${timestamp}-${backup_id}"
partial_dir="$output_root/.${backup_name}.partial"
final_dir="$output_root/$backup_name"
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/swebudd-backup.XXXXXXXX")"
backend_stopped=false
backup_complete=false
database_url_file="$temporary_dir/database-url"
signing_public_key="$temporary_dir/backup-signing-public.pem"

compose=(
  docker compose
  -p "$PROJECT"
  --env-file "$ENV_FILE"
  -f "$compose_file"
)

send_failure_alert() {
  local exit_code="$1"
  [[ -n "$failure_hook" && -x "$failure_hook" && ! -L "$failure_hook" ]] || return 0
  SWEBUDD_ALERT_EVENT="backup_failed" \
  SWEBUDD_ALERT_EXIT_CODE="$exit_code" \
  SWEBUDD_ALERT_PROJECT="$PROJECT" \
  SWEBUDD_ALERT_BACKUP_ID="$backup_id" \
  SWEBUDD_ALERT_PURPOSE="$backup_purpose" \
    "$failure_hook" || {
      echo "Failure alert hook also failed." >&2
      return 1
    }
}

wait_for_backend() {
  local backend_id health running
  backend_id="$("${compose[@]}" ps -q backend)"
  [[ -n "$backend_id" ]] || return 1
  for _attempt in $(seq 1 120); do
    running="$(docker inspect --format '{{.State.Running}}' "$backend_id" 2>/dev/null || true)"
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$backend_id" 2>/dev/null || true)"
    if [[ "$running" == "true" && ( "$health" == "healthy" || "$health" == "none" ) ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

restart_backend() {
  if [[ "$backend_stopped" != "true" ]]; then
    return 0
  fi
  echo "Restarting the quiesced backend..." >&2
  "${compose[@]}" start backend >/dev/null
  wait_for_backend || {
    echo "Backend did not return to a ready state after backup." >&2
    return 1
  }
  backend_stopped=false
}

cleanup() {
  local exit_code=$?
  local cleanup_failed=false
  trap - EXIT INT TERM

  if ! restart_backend; then
    cleanup_failed=true
  fi

  if [[ -n "${partial_dir:-}" && -d "$partial_dir" ]]; then
    case "$partial_dir" in
      "$output_root"/.*.partial) rm -rf -- "$partial_dir" ;;
      *) echo "Refusing to remove unexpected partial path: $partial_dir" >&2 ;;
    esac
  fi
  if [[ -n "${temporary_dir:-}" && -d "$temporary_dir" ]]; then
    case "$temporary_dir" in
      "${TMPDIR:-/tmp}"/swebudd-backup.*) rm -rf -- "$temporary_dir" ;;
      *) echo "Refusing to remove unexpected temporary path: $temporary_dir" >&2 ;;
    esac
  fi

  if [[ "$cleanup_failed" == "true" && "$exit_code" -eq 0 ]]; then
    exit_code=1
  fi
  if [[ "$exit_code" -ne 0 || "$backup_complete" != "true" ]]; then
    send_failure_alert "$exit_code" || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -m 0700 -- "$partial_dir"
printf '%s' "$database_backup_url" > "$database_url_file"
chmod 0600 "$database_url_file"
openssl pkey -in "$signing_private_key" -pubout -out "$signing_public_key"
chmod 0600 "$signing_public_key"

backend_id="$("${compose[@]}" ps -q backend)"
if [[ -n "$backend_id" ]] &&
   [[ "$(docker inspect --format '{{.State.Running}}' "$backend_id")" == "true" ]]; then
  echo "Quiescing the backend so database and media share one write boundary..." >&2
  "${compose[@]}" stop --timeout 60 backend >/dev/null
  backend_stopped=true
fi

metadata="$(
  docker run --rm \
    --network "$network" \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m,mode=1777 \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 64 \
    --volume "$database_url_file:/run/secrets/database-url:ro" \
    --volume "$SCRIPT_DIR/backup-metadata.sql:/deployment/backup-metadata.sql:ro" \
    "$postgres_image" \
    sh -ceu '
      PGDATABASE="$(cat /run/secrets/database-url)"
      export PGDATABASE
      export PGCONNECT_TIMEOUT=10
      exec psql --no-psqlrc --file /deployment/backup-metadata.sql
    '
)"

IFS='|' read -r \
  database_name \
  database_server_version_num \
  database_migrations_count \
  database_users_count \
  database_posts_count \
  database_groups_count \
  metadata_extra <<< "$metadata"

[[ -z "${metadata_extra:-}" && -n "$database_name" ]] ||
  { fail "Database metadata did not have the expected shape."; exit 1; }
for database_count in \
  "$database_server_version_num" \
  "$database_migrations_count" \
  "$database_users_count" \
  "$database_posts_count" \
  "$database_groups_count"
do
  [[ "$database_count" =~ ^[0-9]+$ ]] ||
    { fail "Database metadata contained a non-numeric count."; exit 1; }
done
[[ "$database_name" != *$'\n'* && "$database_name" != *'='* ]] ||
  { fail "Database identity contains unsupported characters."; exit 1; }

database_archive="$partial_dir/database.dump.age"
docker run --rm \
  --network "$network" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 64 \
  --volume "$database_url_file:/run/secrets/database-url:ro" \
  "$postgres_image" \
  sh -ceu '
    PGDATABASE="$(cat /run/secrets/database-url)"
    export PGDATABASE
    export PGCONNECT_TIMEOUT=10
    exec pg_dump \
      --format=custom \
      --compress=9 \
      --no-owner \
      --no-privileges
  ' |
  age --recipient "$age_recipient" --output "$database_archive"

database_sha256="$(sha256sum "$database_archive" | awk '{print $1}')"
media_archive="$partial_dir/media.tar.gz.age"
media_source=""
media_archive_layout="flat-v1"
empty_sha256="$(
  printf '' |
    sha256sum |
    awk '{print $1}'
)"
media_metadata_count=0
media_metadata_sha256="$empty_sha256"
media_store_source="none"
media_store_file_count=0
media_store_inventory_sha256="$empty_sha256"
media_store_metadata_file="none"
media_store_metadata_count=0
media_store_metadata_sha256="$empty_sha256"

if [[ "$media_driver" == "local" ]]; then
  mapfile -t media_volumes < <(
    docker volume ls \
      --filter "label=com.docker.compose.project=$PROJECT" \
      --filter "label=com.docker.compose.volume=swebud_uploads" \
      --quiet
  )
  if (( ${#media_volumes[@]} != 1 )); then
    fail "Expected exactly one Compose uploads volume for project $PROJECT; found ${#media_volumes[@]}."
    exit 1
  fi
  media_source="docker-volume:${media_volumes[0]}"

  media_inventory="$(
    docker run --rm \
      --network none \
      --read-only \
      --cap-drop ALL \
      --security-opt no-new-privileges:true \
      --pids-limit 64 \
      --volume "${media_volumes[0]}:/data:ro" \
      "$media_image" \
      sh -ceu '
        bad_path="$(find /data -mindepth 1 ! -type d ! -type f -print -quit)"
        [ -z "$bad_path" ] || {
          echo "Media volume contains a symlink or special file: $bad_path" >&2
          exit 1
        }
        find /data -type f -exec sh -c '"'"'
          for media_path do
            case "$media_path" in
              *"
"*) exit 42 ;;
            esac
          done
        '"'"' sh {} +
        cd /data
        file_count="$(find . -type f | wc -l | tr -d "[:space:]")"
        inventory_sha="$(find . -type f -exec sha256sum {} \; | LC_ALL=C sort | sha256sum | awk "{print \$1}")"
        printf "%s|%s\n" "$file_count" "$inventory_sha"
      '
  )"

  docker run --rm \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 64 \
    --volume "${media_volumes[0]}:/data:ro" \
    "$media_image" \
    tar -C /data -czf - . |
    age --recipient "$age_recipient" --output "$media_archive"
else
  media_export_dir="$temporary_dir/media-export"
  mkdir -m 0700 "$media_export_dir"
  media_source="s3-single-export"
  media_archive_layout="s3-single-store-with-metadata-v1"
  media_aws_global_args=()
  if [[ -n "$(resolved_value AWS_S3_ENDPOINT)" ]]; then
    media_aws_global_args+=(--endpoint-url "$(resolved_value AWS_S3_ENDPOINT)")
  fi
  if [[ -n "$(resolved_value AWS_REGION)" ]]; then
    media_aws_global_args+=(--region "$(resolved_value AWS_REGION)")
  fi

  export_s3_store() {
    local store="$1"
    local bucket="$2"
    local prefix="$3"
    local store_dir="$media_export_dir/store"
    local objects_dir="$store_dir/objects"
    local metadata_path="$store_dir/s3-object-metadata.json"
    local metadata_entries="$temporary_dir/s3-${store}-metadata.entries.jsonl"
    local object_list="$temporary_dir/s3-${store}-object-list.json"
    local expected_paths="$temporary_dir/s3-${store}-expected-paths.txt"
    local actual_paths="$temporary_dir/s3-${store}-actual-paths.txt"
    local head_response="$temporary_dir/s3-${store}-head-response.json"
    local tags_response="$temporary_dir/s3-${store}-tags-response.json"
    local object_json object_key object_size relative_key directory_marker
    local source file_count inventory_sha256 metadata_count metadata_sha256

    mkdir -p "$objects_dir"
    chmod 0700 "$store_dir" "$objects_dir"
    : > "$metadata_entries"

    aws "${media_aws_global_args[@]}" \
      s3api list-objects-v2 \
      --bucket "$bucket" \
      --prefix "$prefix" \
      --output json > "$object_list"
    jq -e '
      type == "object" and
      ((.Contents // []) | type == "array") and
      all((.Contents // [])[]; (
        type == "object" and
        (.Key | type == "string") and
        (.Key | test("[\u0000-\u001f\u007f]") | not) and
        (.Size | type == "number" and floor == . and . >= 0)
      ))
    ' "$object_list" >/dev/null ||
      { fail "$store S3 media inventory response had an unexpected shape."; exit 1; }

    while IFS= read -r encoded_object; do
      object_json="$(printf '%s' "$encoded_object" | base64 --decode)"
      object_key="$(jq -r '.Key' <<< "$object_json")"
      object_size="$(jq -r '.Size' <<< "$object_json")"
      [[ "$object_key" == "$prefix"* ]] ||
        { fail "$store S3 inventory returned a key outside the configured prefix."; exit 1; }
      relative_key="${object_key#"$prefix"}"
      validate_s3_relative_key "$relative_key" || exit 1
      if [[ "$relative_key" == */ ]]; then
        directory_marker=true
        [[ "$object_size" == "0" ]] ||
          { fail "$store S3 directory-marker objects must be empty."; exit 1; }
      else
        directory_marker=false
      fi

      aws "${media_aws_global_args[@]}" \
        s3api head-object \
        --bucket "$bucket" \
        --key "$object_key" \
        --output json > "$head_response"
      aws "${media_aws_global_args[@]}" \
        s3api get-object-tagging \
        --bucket "$bucket" \
        --key "$object_key" \
        --output json > "$tags_response"
      jq -e --argjson expected_size "$object_size" '
        type == "object" and
        .ContentLength == $expected_size and
        ((.Metadata // {}) | type == "object") and
        all((.Metadata // {})[]; type == "string")
      ' "$head_response" >/dev/null ||
        { fail "$store S3 object metadata response had an unexpected shape."; exit 1; }
      jq -e '
        type == "object" and
        (.TagSet | type == "array") and
        all(.TagSet[]; (
          type == "object" and
          (keys | sort) == ["Key", "Value"] and
          (.Key | type == "string") and
          (.Value | type == "string")
        ))
      ' "$tags_response" >/dev/null ||
        { fail "$store S3 object-tag response had an unexpected shape."; exit 1; }

      jq -cn \
        --arg key "$object_key" \
        --arg relative_path "$relative_key" \
        --argjson directory_marker "$directory_marker" \
        --argjson size "$object_size" \
        --slurpfile head "$head_response" \
        --slurpfile tags "$tags_response" '
          {
            key: $key,
            relativePath: $relative_path,
            directoryMarker: $directory_marker,
            size: $size,
            contentType: ($head[0].ContentType // null),
            cacheControl: ($head[0].CacheControl // null),
            contentDisposition: ($head[0].ContentDisposition // null),
            contentEncoding: ($head[0].ContentEncoding // null),
            contentLanguage: ($head[0].ContentLanguage // null),
            expires: ($head[0].Expires // null),
            websiteRedirectLocation: ($head[0].WebsiteRedirectLocation // null),
            metadata: (($head[0].Metadata // {}) | to_entries | sort_by(.key) | from_entries),
            tags: (($tags[0].TagSet // []) | sort_by(.Key, .Value))
          }
        ' >> "$metadata_entries"
    done < <(jq -r '(.Contents // [])[] | @base64' "$object_list")

    jq -nS \
      --arg store "$store" \
      --arg bucket "$bucket" \
      --arg prefix "$prefix" \
      --slurpfile objects "$metadata_entries" '
        {
          format: "swebudd-s3-object-metadata-v2",
          store: $store,
          source: {
            bucket: $bucket,
            prefix: $prefix
          },
          objects: ($objects | sort_by(.key))
        }
      ' > "$metadata_path"
    chmod 0600 "$metadata_path"

    aws "${media_aws_global_args[@]}" s3 sync \
      "s3://${bucket}/${prefix#/}" \
      "$objects_dir/" \
      --no-follow-symlinks \
      --only-show-errors

    while IFS= read -r -d '' media_path; do
      [[ "$media_path" != *$'\n'* ]] ||
        { fail "$store S3 media export contains a filename with a newline."; exit 1; }
    done < <(find "$store_dir" -mindepth 1 -print0)
    if find "$store_dir" -mindepth 1 ! -type d ! -type f -print -quit | grep -q .; then
      fail "$store S3 media export contains a symlink or special file."
      exit 1
    fi

    source="s3://${bucket}/${prefix#/}"
    metadata_count="$(jq '.objects | length' "$metadata_path")"
    metadata_sha256="$(sha256sum "$metadata_path" | awk '{print $1}')"
    "$SCRIPT_DIR/verify-s3-backup-sidecar.sh" \
      "$store" \
      "$metadata_path" \
      "$metadata_sha256" \
      "$metadata_count" \
      "$source" > "$expected_paths"
    (
      cd "$objects_dir"
      find . -type f -print | LC_ALL=C sort
    ) > "$actual_paths"
    cmp --silent "$expected_paths" "$actual_paths" ||
      { fail "$store S3 export files do not exactly match its source inventory."; exit 1; }

    file_count="$(find "$objects_dir" -type f | wc -l | tr -d '[:space:]')"
    inventory_sha256="$(
      cd "$objects_dir"
      find . -type f -exec sha256sum {} \; |
        LC_ALL=C sort |
        sha256sum |
        awk '{print $1}'
    )"
    printf -v "media_${store}_source" '%s' "$source"
    printf -v "media_${store}_file_count" '%s' "$file_count"
    printf -v "media_${store}_inventory_sha256" '%s' "$inventory_sha256"
    printf -v "media_${store}_metadata_file" '%s' "store/s3-object-metadata.json"
    printf -v "media_${store}_metadata_count" '%s' "$metadata_count"
    printf -v "media_${store}_metadata_sha256" '%s' "$metadata_sha256"
  }

  export_s3_store store "$media_public_bucket" "$media_public_prefix"
  media_file_count="$media_store_file_count"
  media_inventory_sha256="$media_store_inventory_sha256"
  media_metadata_count="$media_store_metadata_count"
  media_metadata_sha256="$media_store_metadata_sha256"
  tar --create --gzip --file - --directory "$media_export_dir" . |
    age --recipient "$age_recipient" --output "$media_archive"
  media_inventory="${media_file_count}|${media_inventory_sha256}"
fi

IFS='|' read -r media_file_count media_inventory_sha256 media_extra <<< "$media_inventory"
[[ -z "${media_extra:-}" && "$media_file_count" =~ ^[0-9]+$ &&
   "$media_inventory_sha256" =~ ^[a-f0-9]{64}$ ]] ||
  { fail "Media inventory did not have the expected shape."; exit 1; }
[[ "$media_metadata_count" =~ ^[0-9]+$ &&
   "$media_metadata_sha256" =~ ^[a-f0-9]{64}$ ]] ||
  { fail "Media metadata inventory did not have the expected shape."; exit 1; }
[[ "$media_store_file_count" =~ ^[0-9]+$ &&
   "$media_store_inventory_sha256" =~ ^[a-f0-9]{64}$ &&
   "$media_store_metadata_count" =~ ^[0-9]+$ &&
   "$media_store_metadata_sha256" =~ ^[a-f0-9]{64}$ ]] ||
  { fail "Media-store inventory did not have the expected shape."; exit 1; }
if [[ "$media_driver" == "local" ]]; then
  [[ "$media_store_source" == "none" &&
     "$media_store_file_count" == "0" &&
     "$media_store_inventory_sha256" == "$empty_sha256" &&
     "$media_store_metadata_file" == "none" &&
     "$media_store_metadata_count" == "0" &&
     "$media_store_metadata_sha256" == "$empty_sha256" ]] ||
    { fail "Local-media backup has nonempty S3 store metadata."; exit 1; }
else
  [[ "$media_store_source" =~ ^s3://[A-Za-z0-9][A-Za-z0-9._-]*/ &&
     "$media_store_metadata_file" == "store/s3-object-metadata.json" &&
     "$media_file_count" == "$media_store_file_count" &&
     "$media_inventory_sha256" == "$media_store_inventory_sha256" &&
     "$media_metadata_count" == "$media_store_metadata_count" &&
     "$media_metadata_sha256" == "$media_store_metadata_sha256" ]] ||
    { fail "S3 media backup has invalid single-store metadata."; exit 1; }
fi
media_sha256="$(sha256sum "$media_archive" | awk '{print $1}')"

# End the write outage before manifest construction and offsite transfer.
restart_backend || exit 1

git_commit="$(git -C "$SCRIPT_DIR/.." rev-parse HEAD 2>/dev/null || printf 'unknown')"
manifest_plain="$temporary_dir/manifest.txt"
cat_manifest_value() {
  local key="$1"
  local value="$2"
  [[ "$value" != *$'\n'* && "$value" != *'='* ]] ||
    { fail "Manifest value $key contains unsupported characters."; exit 1; }
  printf '%s=%s\n' "$key" "$value" >> "$manifest_plain"
}

: > "$manifest_plain"
cat_manifest_value format swebudd-backup-v3
cat_manifest_value backup_id "$backup_id"
cat_manifest_value backup_purpose "$backup_purpose"
cat_manifest_value created_at_utc "$timestamp"
cat_manifest_value created_epoch "$created_epoch"
cat_manifest_value project "$PROJECT"
cat_manifest_value git_commit "$git_commit"
cat_manifest_value database_name "$database_name"
cat_manifest_value database_server_version_num "$database_server_version_num"
cat_manifest_value database_migrations_count "$database_migrations_count"
cat_manifest_value database_users_count "$database_users_count"
cat_manifest_value database_posts_count "$database_posts_count"
cat_manifest_value database_groups_count "$database_groups_count"
cat_manifest_value database_archive database.dump.age
cat_manifest_value database_sha256 "$database_sha256"
cat_manifest_value media_driver "$media_driver"
cat_manifest_value media_source "$media_source"
cat_manifest_value media_archive media.tar.gz.age
cat_manifest_value media_sha256 "$media_sha256"
cat_manifest_value media_file_count "$media_file_count"
cat_manifest_value media_inventory_sha256 "$media_inventory_sha256"
cat_manifest_value media_archive_layout "$media_archive_layout"
cat_manifest_value media_metadata_count "$media_metadata_count"
cat_manifest_value media_metadata_sha256 "$media_metadata_sha256"
cat_manifest_value media_store_source "$media_store_source"
cat_manifest_value media_store_file_count "$media_store_file_count"
cat_manifest_value media_store_inventory_sha256 "$media_store_inventory_sha256"
cat_manifest_value media_store_metadata_file "$media_store_metadata_file"
cat_manifest_value media_store_metadata_count "$media_store_metadata_count"
cat_manifest_value media_store_metadata_sha256 "$media_store_metadata_sha256"
cat_manifest_value rpo_target_hours "$rpo_hours"
cat_manifest_value rto_target_hours "$rto_hours"
cat_manifest_value retention_days "$retention_days"
cat_manifest_value postgres_helper_image "$postgres_image"
cat_manifest_value media_helper_image "$media_image"
cat_manifest_value signing_algorithm ed25519
cat_manifest_value signing_public_key_sha256 "$signing_public_key_sha256"

manifest_archive="$partial_dir/manifest.age"
age --recipient "$age_recipient" --output "$manifest_archive" "$manifest_plain"
manifest_sha256="$(sha256sum "$manifest_archive" | awk '{print $1}')"

cat > "$partial_dir/COMPLETE" <<EOF
format=swebudd-backup-v3
backup_id=$backup_id
manifest_sha256=$manifest_sha256
signing_algorithm=ed25519
EOF
openssl pkeyutl \
  -sign \
  -rawin \
  -inkey "$signing_private_key" \
  -in "$partial_dir/COMPLETE" \
  -out "$partial_dir/COMPLETE.sig"
[[ "$(stat -c '%s' "$partial_dir/COMPLETE.sig")" == "64" ]] ||
  { fail "Detached Ed25519 signature did not have the expected 64-byte size."; exit 1; }
openssl pkeyutl \
  -verify \
  -pubin \
  -inkey "$signing_public_key" \
  -rawin \
  -in "$partial_dir/COMPLETE" \
  -sigfile "$partial_dir/COMPLETE.sig" >/dev/null ||
  { fail "Self-verification of the backup creator signature failed."; exit 1; }
chmod 0600 "$partial_dir"/*

mv -- "$partial_dir" "$final_dir"
partial_dir=""

if [[ -n "$offsite_uri" ]]; then
  destination="${offsite_uri%/}/$backup_name"
  upload_args=()
  backup_endpoint="$(resolved_value BACKUP_S3_ENDPOINT)"
  backup_region="$(resolved_value BACKUP_AWS_REGION "$(resolved_value AWS_REGION)")"
  backup_sse="$(resolved_value BACKUP_S3_SSE AES256)"
  [[ "$production" != "true" || "$backup_sse" != "none" ]] ||
    { fail "Production offsite uploads cannot disable server-side encryption."; exit 1; }
  [[ -z "$backup_endpoint" ]] || upload_args+=(--endpoint-url "$backup_endpoint")
  [[ -z "$backup_region" ]] || upload_args+=(--region "$backup_region")
  [[ "$backup_sse" == "none" ]] || upload_args+=(--sse "$backup_sse")

  aws "${upload_args[@]}" s3 cp "$final_dir" "$destination/" \
    --recursive \
    --exclude COMPLETE \
    --only-show-errors
  aws "${upload_args[@]}" s3 cp "$final_dir/COMPLETE" "$destination/COMPLETE" \
    --only-show-errors
  aws "${upload_args[@]}" s3 cp "$destination/COMPLETE" "$temporary_dir/remote-COMPLETE" \
    --only-show-errors
  cmp --silent "$final_dir/COMPLETE" "$temporary_dir/remote-COMPLETE" ||
    { fail "Remote COMPLETE marker verification failed."; exit 1; }
  aws "${upload_args[@]}" s3 cp "$destination/COMPLETE.sig" "$temporary_dir/remote-COMPLETE.sig" \
    --only-show-errors
  cmp --silent "$final_dir/COMPLETE.sig" "$temporary_dir/remote-COMPLETE.sig" ||
    { fail "Remote creator-signature verification failed."; exit 1; }
  echo "Encrypted backup uploaded with COMPLETE last to $destination/." >&2
else
  echo "Encrypted local-only backup created under the explicit local-only policy." >&2
fi

result_file="$(resolved_value BACKUP_RESULT_FILE)"
if [[ -n "$result_file" ]]; then
  [[ "$result_file" == /* && ! -L "$result_file" ]] ||
    { fail "BACKUP_RESULT_FILE must be an absolute, non-symlink path."; exit 1; }
  result_parent="$(dirname "$result_file")"
  [[ -d "$result_parent" && ! -L "$result_parent" ]] ||
    { fail "BACKUP_RESULT_FILE parent must be a non-symlink directory."; exit 1; }
  result_temporary="$(mktemp "$result_parent/.swebudd-backup-result.XXXXXXXX")"
  printf '%s\n' "$final_dir" > "$result_temporary"
  chmod 0600 "$result_temporary"
  mv -- "$result_temporary" "$result_file"
fi

# Retention applies only to complete, locally generated backup sets and only
# after this backup has been durably completed (and uploaded when configured).
while IFS= read -r -d '' expired_backup; do
  case "$expired_backup" in
    "$output_root"/*) ;;
    *) fail "Refusing to prune path outside BACKUP_OUTPUT_DIR: $expired_backup"; exit 1 ;;
  esac
  expired_name="${expired_backup##*/}"
  [[ "$expired_name" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}$ ]] ||
    { fail "Refusing to prune unexpected backup path: $expired_backup"; exit 1; }
  [[ ! -L "$expired_backup" && -f "$expired_backup/COMPLETE" ]] ||
    { fail "Refusing to prune incomplete or symlinked backup: $expired_backup"; exit 1; }
  grep -Eqx 'format=swebudd-backup-v(2|3)' "$expired_backup/COMPLETE" ||
    { fail "Refusing to prune a backup with an unknown marker: $expired_backup"; exit 1; }
  rm -rf -- "$expired_backup"
done < <(
  find "$output_root" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    -name '????????T??????Z-????????????????????????????????' \
    -mtime "+$retention_days" \
    -print0
)

backup_complete=true
echo "BACKUP_CREATED=$final_dir"
