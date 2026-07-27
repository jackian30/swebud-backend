#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SWEBUD_ENV_FILE:-$SCRIPT_DIR/.env}"
PROJECT="${COMPOSE_PROJECT_NAME:-swebud}"

if (( $# != 1 )); then
  echo "Usage: $0 /absolute/path/to/backup-directory" >&2
  exit 1
fi

env_value() {
  local key="$1"
  local fallback="${2:-}"
  local value=""
  if [[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]]; then
    value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -1)"
  fi
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

require_digest_image() {
  local variable_name="$1"
  local image="$2"
  [[ "$image" =~ @sha256:[a-f0-9]{64}$ ]] ||
    fail "$variable_name must use an immutable @sha256 digest."
}

validate_no_symlink_components() {
  local path="$1"
  local current="/"
  local component
  local remainder="${path#/}"

  IFS='/' read -r -a path_components <<< "$remainder"
  for component in "${path_components[@]}"; do
    [[ -n "$component" ]] || continue
    current="${current%/}/$component"
    [[ ! -L "$current" ]] ||
      { fail "Path cannot contain a symbolic-link component: $current"; return 1; }
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
    { fail "$variable_name must be owned by the account running the drill."; return 1; }
  permissions="$(stat -c '%a' "$path")"
  (( (8#$permissions & 077) == 0 )) ||
    { fail "$variable_name cannot be readable or writable by group/other."; return 1; }
}

validate_s3_relative_key() {
  local relative_key="$1"
  local path_key="${relative_key%/}"
  local component

  [[ -n "$path_key" && "$path_key" != /* ]] ||
    { fail "S3 metadata contains an empty or absolute archive path."; return 1; }
  if LC_ALL=C grep -q '[[:cntrl:]]' < <(printf '%s' "$path_key"); then
    fail "S3 metadata contains a key with control characters."
    return 1
  fi
  IFS='/' read -r -a key_components <<< "$path_key"
  for component in "${key_components[@]}"; do
    [[ -n "$component" && "$component" != "." && "$component" != ".." ]] ||
      { fail "S3 metadata contains an unsafe path component."; return 1; }
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

parse_key_value_document() {
  local path="$1"
  local destination_name="$2"
  shift 2
  local -n destination="$destination_name"
  local -A allowed=()
  local key value allowed_key

  destination=()
  for allowed_key in "$@"; do
    allowed["$allowed_key"]=1
  done

  while IFS='=' read -r key value || [[ -n "$key$value" ]]; do
    [[ "$key" =~ ^[a-z][a-z0-9_]*$ && -v "allowed[$key]" ]] ||
      { fail "Unexpected key '$key' in $(basename "$path")."; return 1; }
    [[ ! -v "destination[$key]" ]] ||
      { fail "Duplicate key '$key' in $(basename "$path")."; return 1; }
    [[ -n "$value" && "$value" != *$'\r'* && "$value" != *$'\n'* ]] ||
      { fail "Key '$key' has an empty or invalid value."; return 1; }
    destination["$key"]="$value"
  done < "$path"

  (( ${#destination[@]} == ${#allowed[@]} )) ||
    { fail "$(basename "$path") does not contain the exact required key set."; return 1; }
}

backup_dir="$1"
[[ "$backup_dir" == /* && "$backup_dir" != "/" ]] ||
  { fail "Backup directory must be an absolute non-root path."; exit 1; }
validate_no_symlink_components "$backup_dir" || exit 1
[[ -d "$backup_dir" && ! -L "$backup_dir" ]] ||
  { fail "Backup directory must be an existing non-symlink directory."; exit 1; }
backup_permissions="$(stat -c '%a' "$backup_dir")"
(( (8#$backup_permissions & 077) == 0 )) ||
  { fail "Backup directory cannot be accessible by group/other."; exit 1; }

identity_file="${BACKUP_AGE_IDENTITY_FILE:-}"
[[ -n "$identity_file" ]] ||
  { fail "BACKUP_AGE_IDENTITY_FILE is required."; exit 1; }
signing_public_key="$(resolved_value BACKUP_SIGNING_PUBLIC_KEY_FILE)"
[[ -n "$signing_public_key" ]] ||
  { fail "BACKUP_SIGNING_PUBLIC_KEY_FILE is required."; exit 1; }

for command_name in age base64 cmp date docker find jq openssl sha256sum stat tar; do
  require_command "$command_name" || exit 1
done
validate_private_file BACKUP_AGE_IDENTITY_FILE "$identity_file" || exit 1

mode="$(resolved_value SWEBUD_MODE dev)"
case "$mode" in
  dev|local|development) production=false ;;
  prod|production) production=true ;;
  *)
    fail "Unknown SWEBUD_MODE '$mode'. Use dev or prod."
    exit 1
    ;;
esac

failure_hook="$(resolved_value FAILURE_ALERT_HOOK)"
if [[ "$production" == "true" ]]; then
  validate_failure_hook "$failure_hook" || exit 1
fi

# Never let backup data select an executable image. The operator-configured
# digests below are the allowlist; later, the creator-signed manifest must match
# them exactly before either image is executed.
postgres_image="$(resolved_value POSTGRES_HELPER_IMAGE)"
media_image="$(resolved_value MEDIA_HELPER_IMAGE)"
[[ -n "$postgres_image" && -n "$media_image" ]] ||
  { fail "POSTGRES_HELPER_IMAGE and MEDIA_HELPER_IMAGE are required."; exit 1; }
require_digest_image POSTGRES_HELPER_IMAGE "$postgres_image" || exit 1
require_digest_image MEDIA_HELPER_IMAGE "$media_image" || exit 1

mapfile -t backup_entries < <(
  find "$backup_dir" -mindepth 1 -maxdepth 1 -printf '%f|%y\n' | LC_ALL=C sort
)
expected_entries=(
  'COMPLETE|f'
  'COMPLETE.sig|f'
  'database.dump.age|f'
  'manifest.age|f'
  'media.tar.gz.age|f'
)
if [[ "${backup_entries[*]}" != "${expected_entries[*]}" ]]; then
  fail "Backup directory does not match the exact five-file allowlist."
  exit 1
fi
for artifact in COMPLETE COMPLETE.sig database.dump.age manifest.age media.tar.gz.age; do
  [[ -f "$backup_dir/$artifact" && ! -L "$backup_dir/$artifact" ]] ||
    { fail "Backup artifact must be a non-symlink regular file: $artifact"; exit 1; }
done

"$SCRIPT_DIR/verify-backup-signature.sh" "$backup_dir" "$signing_public_key" ||
  exit 1
signing_public_key_sha256="$(
  openssl pkey -pubin -in "$signing_public_key" -outform DER |
    sha256sum |
    awk '{print $1}'
)"
[[ "$signing_public_key_sha256" =~ ^[a-f0-9]{64}$ ]] ||
  { fail "Could not fingerprint the pinned backup signing public key."; exit 1; }

declare -A complete_marker=()
parse_key_value_document \
  "$backup_dir/COMPLETE" \
  complete_marker \
  format backup_id manifest_sha256 signing_algorithm || exit 1

[[ "${complete_marker[format]}" == "swebudd-backup-v2" ||
   "${complete_marker[format]}" == "swebudd-backup-v3" ]] ||
  { fail "Unsupported COMPLETE marker format."; exit 1; }
[[ "${complete_marker[signing_algorithm]}" == "ed25519" ]] ||
  { fail "Unsupported backup creator-signature algorithm."; exit 1; }
[[ "${complete_marker[backup_id]}" =~ ^[a-f0-9]{32}$ ]] ||
  { fail "COMPLETE marker backup_id must contain 128 bits of lowercase hex."; exit 1; }
[[ "${complete_marker[manifest_sha256]}" =~ ^[a-f0-9]{64}$ ]] ||
  { fail "COMPLETE marker manifest hash is invalid."; exit 1; }

actual_manifest_sha256="$(sha256sum "$backup_dir/manifest.age" | awk '{print $1}')"
[[ "$actual_manifest_sha256" == "${complete_marker[manifest_sha256]}" ]] ||
  { fail "Encrypted manifest hash does not match COMPLETE."; exit 1; }

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/swebudd-restore.XXXXXXXX")"
manifest_plain="$temporary_dir/manifest.txt"
s3_public_metadata_plain="$temporary_dir/public-s3-object-metadata.json"
s3_quarantine_metadata_plain="$temporary_dir/quarantine-s3-object-metadata.json"
media_database_references_plain="$temporary_dir/media-database-references.json"
expected_public_media_paths="$temporary_dir/expected-public-media-paths.txt"
expected_quarantine_media_paths="$temporary_dir/expected-quarantine-media-paths.txt"
: > "$expected_public_media_paths"
: > "$expected_quarantine_media_paths"
container=""
database_volume=""
media_volume=""
container_created=false
database_volume_created=false
media_volume_created=false
drill_complete=false
backup_id="${complete_marker[backup_id]}"

send_failure_alert() {
  local exit_code="$1"
  [[ -n "$failure_hook" && -x "$failure_hook" && ! -L "$failure_hook" ]] || return 0
  SWEBUDD_ALERT_EVENT="restore_drill_failed" \
  SWEBUDD_ALERT_EXIT_CODE="$exit_code" \
  SWEBUDD_ALERT_PROJECT="$PROJECT" \
  SWEBUDD_ALERT_BACKUP_ID="$backup_id" \
    "$failure_hook" || {
      echo "Failure alert hook also failed." >&2
      return 1
    }
}

container_has_expected_label() {
  [[ "$(docker inspect \
    --format '{{index .Config.Labels "com.swebudd.restore-id"}}' \
    "$container" 2>/dev/null || true)" == "$backup_id" ]]
}

volume_has_expected_label() {
  local volume="$1"
  [[ "$(docker volume inspect \
    --format '{{index .Labels "com.swebudd.restore-id"}}' \
    "$volume" 2>/dev/null || true)" == "$backup_id" ]]
}

cleanup() {
  local exit_code=$?
  local cleanup_failed=false
  trap - EXIT INT TERM

  if [[ "$container_created" == "true" ]]; then
    if container_has_expected_label; then
      docker rm --force "$container" >/dev/null 2>&1 || cleanup_failed=true
    else
      echo "Refusing to remove restore container after label mismatch: $container" >&2
      cleanup_failed=true
    fi
  fi
  if [[ "$media_volume_created" == "true" ]]; then
    if volume_has_expected_label "$media_volume"; then
      docker volume rm "$media_volume" >/dev/null 2>&1 || cleanup_failed=true
    else
      echo "Refusing to remove media volume after label mismatch: $media_volume" >&2
      cleanup_failed=true
    fi
  fi
  if [[ "$database_volume_created" == "true" ]]; then
    if volume_has_expected_label "$database_volume"; then
      docker volume rm "$database_volume" >/dev/null 2>&1 || cleanup_failed=true
    else
      echo "Refusing to remove database volume after label mismatch: $database_volume" >&2
      cleanup_failed=true
    fi
  fi
  case "$temporary_dir" in
    "${TMPDIR:-/tmp}"/swebudd-restore.*) rm -rf -- "$temporary_dir" ;;
    *) echo "Refusing to remove unexpected temporary path: $temporary_dir" >&2 ;;
  esac

  if [[ "$cleanup_failed" == "true" && "$exit_code" -eq 0 ]]; then
    exit_code=1
  fi
  if [[ "$exit_code" -ne 0 || "$drill_complete" != "true" ]]; then
    send_failure_alert "$exit_code" || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

age \
  --decrypt \
  --identity "$identity_file" \
  --output "$manifest_plain" \
  "$backup_dir/manifest.age"
chmod 0600 "$manifest_plain"

common_manifest_keys=(
  format
  backup_id
  backup_purpose
  created_at_utc
  created_epoch
  project
  git_commit
  database_name
  database_server_version_num
  database_migrations_count
  database_users_count
  database_posts_count
  database_groups_count
  database_archive
  database_sha256
  media_driver
  media_source
  media_archive
  media_sha256
  media_file_count
  media_inventory_sha256
  media_archive_layout
  media_metadata_count
  media_metadata_sha256
  rpo_target_hours
  rto_target_hours
  retention_days
  postgres_helper_image
  media_helper_image
  signing_algorithm
  signing_public_key_sha256
)
legacy_manifest_keys=(
  media_public_source
  media_public_file_count
  media_public_inventory_sha256
  media_public_metadata_file
  media_public_metadata_count
  media_public_metadata_sha256
  media_quarantine_source
  media_quarantine_file_count
  media_quarantine_inventory_sha256
  media_quarantine_metadata_file
  media_quarantine_metadata_count
  media_quarantine_metadata_sha256
  media_database_references_file
  media_database_references_sha256
  media_database_public_reference_count
  media_database_quarantine_reference_count
  media_unfinished_multipart_count
)
single_store_manifest_keys=(
  media_store_source
  media_store_file_count
  media_store_inventory_sha256
  media_store_metadata_file
  media_store_metadata_count
  media_store_metadata_sha256
)
declare -A manifest=()
case "${complete_marker[format]}" in
  swebudd-backup-v2)
    parse_key_value_document \
      "$manifest_plain" \
      manifest \
      "${common_manifest_keys[@]}" \
      "${legacy_manifest_keys[@]}" || exit 1
    ;;
  swebudd-backup-v3)
    parse_key_value_document \
      "$manifest_plain" \
      manifest \
      "${common_manifest_keys[@]}" \
      "${single_store_manifest_keys[@]}" || exit 1
    ;;
esac

[[ "${manifest[format]}" == "${complete_marker[format]}" ]] ||
  { fail "Unsupported creator-signed manifest format."; exit 1; }
[[ "${manifest[backup_id]}" == "$backup_id" ]] ||
  { fail "Creator-signed manifest backup_id does not match COMPLETE."; exit 1; }
[[ "${manifest[database_archive]}" == "database.dump.age" &&
   "${manifest[media_archive]}" == "media.tar.gz.age" ]] ||
  { fail "Creator-signed manifest contains unexpected artifact names."; exit 1; }
[[ "${manifest[database_sha256]}" =~ ^[a-f0-9]{64}$ &&
   "${manifest[media_sha256]}" =~ ^[a-f0-9]{64}$ &&
   "${manifest[media_inventory_sha256]}" =~ ^[a-f0-9]{64}$ &&
   "${manifest[media_metadata_sha256]}" =~ ^[a-f0-9]{64}$ &&
   "${manifest[signing_public_key_sha256]}" =~ ^[a-f0-9]{64}$ ]] ||
  { fail "Creator-signed manifest contains an invalid hash."; exit 1; }
case "${manifest[format]}" in
  swebudd-backup-v2)
    [[ "${manifest[media_public_inventory_sha256]}" =~ ^[a-f0-9]{64}$ &&
       "${manifest[media_public_metadata_sha256]}" =~ ^[a-f0-9]{64}$ &&
       "${manifest[media_quarantine_inventory_sha256]}" =~ ^[a-f0-9]{64}$ &&
       "${manifest[media_quarantine_metadata_sha256]}" =~ ^[a-f0-9]{64}$ &&
       "${manifest[media_database_references_sha256]}" =~ ^[a-f0-9]{64}$ ]] ||
      { fail "Legacy creator-signed manifest contains an invalid media hash."; exit 1; }
    ;;
  swebudd-backup-v3)
    [[ "${manifest[media_store_inventory_sha256]}" =~ ^[a-f0-9]{64}$ &&
       "${manifest[media_store_metadata_sha256]}" =~ ^[a-f0-9]{64}$ ]] ||
      { fail "Single-store creator-signed manifest contains an invalid media hash."; exit 1; }
    ;;
esac
[[ "${manifest[created_at_utc]}" =~ ^[0-9]{8}T[0-9]{6}Z$ &&
   "${manifest[created_epoch]}" =~ ^[0-9]+$ ]] ||
  { fail "Creator-signed manifest contains an invalid creation time."; exit 1; }
[[ "${manifest[media_driver]}" == "local" || "${manifest[media_driver]}" == "s3" ]] ||
  { fail "Creator-signed manifest contains an unsupported media driver."; exit 1; }
[[ "${manifest[backup_purpose]}" == "scheduled" ||
   "${manifest[backup_purpose]}" == "manual" ||
   "${manifest[backup_purpose]}" == "pre-migration" ]] ||
  { fail "Creator-signed manifest contains an unsupported backup purpose."; exit 1; }
[[ "${manifest[signing_algorithm]}" == "ed25519" &&
   "${manifest[signing_algorithm]}" == "${complete_marker[signing_algorithm]}" &&
   "${manifest[signing_public_key_sha256]}" == "$signing_public_key_sha256" ]] ||
  { fail "Creator-signed manifest does not match the pinned Ed25519 public key."; exit 1; }

empty_sha256="$(
  printf '' |
    sha256sum |
    awk '{print $1}'
)"
numeric_keys=(
  database_server_version_num
  database_migrations_count
  database_users_count
  database_posts_count
  database_groups_count
  media_file_count
  media_metadata_count
  rpo_target_hours
  rto_target_hours
  retention_days
)
case "${manifest[format]}" in
  swebudd-backup-v2)
    numeric_keys+=(
      media_public_file_count
      media_public_metadata_count
      media_quarantine_file_count
      media_quarantine_metadata_count
      media_database_public_reference_count
      media_database_quarantine_reference_count
      media_unfinished_multipart_count
    )
    case "${manifest[media_driver]}" in
      local)
        [[ "${manifest[media_archive_layout]}" == "flat-v1" &&
           "${manifest[media_source]}" == docker-volume:* &&
           "${manifest[media_metadata_count]}" == "0" &&
           "${manifest[media_metadata_sha256]}" == "$empty_sha256" &&
           "${manifest[media_public_source]}" == "none" &&
           "${manifest[media_public_file_count]}" == "0" &&
           "${manifest[media_public_inventory_sha256]}" == "$empty_sha256" &&
           "${manifest[media_public_metadata_file]}" == "none" &&
           "${manifest[media_public_metadata_count]}" == "0" &&
           "${manifest[media_public_metadata_sha256]}" == "$empty_sha256" &&
           "${manifest[media_quarantine_source]}" == "none" &&
           "${manifest[media_quarantine_file_count]}" == "0" &&
           "${manifest[media_quarantine_inventory_sha256]}" == "$empty_sha256" &&
           "${manifest[media_quarantine_metadata_file]}" == "none" &&
           "${manifest[media_quarantine_metadata_count]}" == "0" &&
           "${manifest[media_quarantine_metadata_sha256]}" == "$empty_sha256" &&
           "${manifest[media_database_references_file]}" == "none" &&
           "${manifest[media_database_references_sha256]}" == "$empty_sha256" &&
           "${manifest[media_database_public_reference_count]}" == "0" &&
           "${manifest[media_database_quarantine_reference_count]}" == "0" &&
           "${manifest[media_unfinished_multipart_count]}" == "0" ]] ||
          { fail "Legacy local-media manifest has an invalid archive layout."; exit 1; }
        ;;
      s3)
        [[ "${manifest[media_archive_layout]}" == "s3-dual-store-with-metadata-v1" &&
           "${manifest[media_source]}" == "s3-dual-export" &&
           "${manifest[media_public_source]}" =~ ^s3://[A-Za-z0-9][A-Za-z0-9._-]*/ &&
           "${manifest[media_quarantine_source]}" =~ ^s3://[A-Za-z0-9][A-Za-z0-9._-]*/ &&
           "${manifest[media_public_source]}" != "${manifest[media_quarantine_source]}" &&
           "${manifest[media_public_metadata_file]}" == "stores/public/s3-object-metadata.json" &&
           "${manifest[media_quarantine_metadata_file]}" == "stores/quarantine/s3-object-metadata.json" &&
           "${manifest[media_database_references_file]}" == "media-database-references.json" ]] ||
          { fail "Legacy S3-media manifest has an invalid archive layout."; exit 1; }
        ;;
    esac
    ;;
  swebudd-backup-v3)
    numeric_keys+=(media_store_file_count media_store_metadata_count)
    case "${manifest[media_driver]}" in
      local)
        [[ "${manifest[media_archive_layout]}" == "flat-v1" &&
           "${manifest[media_source]}" == docker-volume:* &&
           "${manifest[media_metadata_count]}" == "0" &&
           "${manifest[media_metadata_sha256]}" == "$empty_sha256" &&
           "${manifest[media_store_source]}" == "none" &&
           "${manifest[media_store_file_count]}" == "0" &&
           "${manifest[media_store_inventory_sha256]}" == "$empty_sha256" &&
           "${manifest[media_store_metadata_file]}" == "none" &&
           "${manifest[media_store_metadata_count]}" == "0" &&
           "${manifest[media_store_metadata_sha256]}" == "$empty_sha256" ]] ||
          { fail "Single-store local-media manifest has an invalid archive layout."; exit 1; }
        ;;
      s3)
        [[ "${manifest[media_archive_layout]}" == "s3-single-store-with-metadata-v1" &&
           "${manifest[media_source]}" == "s3-single-export" &&
           "${manifest[media_store_source]}" =~ ^s3://[A-Za-z0-9][A-Za-z0-9._-]*/ &&
           "${manifest[media_store_metadata_file]}" == "store/s3-object-metadata.json" ]] ||
          { fail "Single-store S3-media manifest has an invalid archive layout."; exit 1; }
        ;;
    esac
    ;;
esac
for numeric_key in "${numeric_keys[@]}"; do
  [[ "${manifest[$numeric_key]}" =~ ^[0-9]+$ ]] ||
    { fail "Manifest key $numeric_key must be numeric."; exit 1; }
done
if [[ "${manifest[media_driver]}" == "s3" ]]; then
  if [[ "${manifest[format]}" == "swebudd-backup-v2" ]]; then
    (( ${manifest[media_file_count]} ==
       ${manifest[media_public_file_count]} +
       ${manifest[media_quarantine_file_count]} )) ||
      { fail "Legacy S3 media file count does not equal its two store counts."; exit 1; }
    (( ${manifest[media_metadata_count]} ==
       ${manifest[media_public_metadata_count]} +
       ${manifest[media_quarantine_metadata_count]} )) ||
      { fail "Legacy S3 media metadata count does not equal its two store counts."; exit 1; }
    expected_combined_metadata_sha256="$(
      printf 'public=%s\nquarantine=%s\n' \
        "${manifest[media_public_metadata_sha256]}" \
        "${manifest[media_quarantine_metadata_sha256]}" |
        sha256sum |
        awk '{print $1}'
    )"
    [[ "$expected_combined_metadata_sha256" == "${manifest[media_metadata_sha256]}" ]] ||
      { fail "Legacy S3 media metadata aggregate hash is invalid."; exit 1; }
  else
    [[ "${manifest[media_file_count]}" == "${manifest[media_store_file_count]}" &&
       "${manifest[media_inventory_sha256]}" == "${manifest[media_store_inventory_sha256]}" &&
       "${manifest[media_metadata_count]}" == "${manifest[media_store_metadata_count]}" &&
       "${manifest[media_metadata_sha256]}" == "${manifest[media_store_metadata_sha256]}" ]] ||
      { fail "Single-store S3 media aggregate inventory is invalid."; exit 1; }
  fi
fi

# Normalize the v3 single-store schema to the internal comparison fields used
# by the extraction verifier. The exact signed v3 manifest itself never
# contains the retired quarantine or upload-v2 reference keys.
if [[ "${manifest[format]}" == "swebudd-backup-v3" ]]; then
  manifest[media_public_source]="${manifest[media_store_source]}"
  manifest[media_public_file_count]="${manifest[media_store_file_count]}"
  manifest[media_public_inventory_sha256]="${manifest[media_store_inventory_sha256]}"
  manifest[media_public_metadata_file]="${manifest[media_store_metadata_file]}"
  manifest[media_public_metadata_count]="${manifest[media_store_metadata_count]}"
  manifest[media_public_metadata_sha256]="${manifest[media_store_metadata_sha256]}"
  manifest[media_quarantine_source]="none"
  manifest[media_quarantine_file_count]="0"
  manifest[media_quarantine_inventory_sha256]="$empty_sha256"
  manifest[media_quarantine_metadata_file]="none"
  manifest[media_quarantine_metadata_count]="0"
  manifest[media_quarantine_metadata_sha256]="$empty_sha256"
  manifest[media_database_references_file]="none"
  manifest[media_database_references_sha256]="$empty_sha256"
  manifest[media_database_public_reference_count]="0"
  manifest[media_database_quarantine_reference_count]="0"
  manifest[media_unfinished_multipart_count]="0"
fi
for positive_key in rpo_target_hours rto_target_hours retention_days; do
  (( ${manifest[$positive_key]} > 0 && ${manifest[$positive_key]} <= 8760 )) ||
    { fail "Manifest key $positive_key is outside the accepted policy range."; exit 1; }
done

expected_project="$(resolved_value RESTORE_EXPECTED_PROJECT "$PROJECT")"
expected_database_name="$(
  resolved_value RESTORE_EXPECTED_DATABASE_NAME "$(resolved_value POSTGRES_DB swebud)"
)"
[[ "${manifest[project]}" == "$expected_project" ]] ||
  { fail "Backup project identity does not match RESTORE_EXPECTED_PROJECT."; exit 1; }
[[ "${manifest[database_name]}" == "$expected_database_name" ]] ||
  { fail "Backup database identity does not match RESTORE_EXPECTED_DATABASE_NAME."; exit 1; }

actual_database_sha256="$(sha256sum "$backup_dir/database.dump.age" | awk '{print $1}')"
actual_media_sha256="$(sha256sum "$backup_dir/media.tar.gz.age" | awk '{print $1}')"
[[ "$actual_database_sha256" == "${manifest[database_sha256]}" ]] ||
  { fail "Encrypted database artifact hash does not match the creator-signed manifest."; exit 1; }
[[ "$actual_media_sha256" == "${manifest[media_sha256]}" ]] ||
  { fail "Encrypted media artifact hash does not match the creator-signed manifest."; exit 1; }

if [[ "${manifest[media_driver]}" == "s3" ]]; then
  age --decrypt --identity "$identity_file" "$backup_dir/media.tar.gz.age" |
    tar \
      --extract \
      --gzip \
      --to-stdout \
      --file - \
      "./${manifest[media_public_metadata_file]}" > "$s3_public_metadata_plain"
  chmod 0600 "$s3_public_metadata_plain"

  if [[ "${manifest[format]}" == "swebudd-backup-v3" ]]; then
    "$SCRIPT_DIR/verify-s3-backup-sidecar.sh" \
      store \
      "$s3_public_metadata_plain" \
      "${manifest[media_public_metadata_sha256]}" \
      "${manifest[media_public_metadata_count]}" \
      "${manifest[media_public_source]}" > "$expected_public_media_paths"
  else
    age --decrypt --identity "$identity_file" "$backup_dir/media.tar.gz.age" |
      tar \
        --extract \
        --gzip \
        --to-stdout \
        --file - \
        "./${manifest[media_quarantine_metadata_file]}" > "$s3_quarantine_metadata_plain"
    age --decrypt --identity "$identity_file" "$backup_dir/media.tar.gz.age" |
      tar \
        --extract \
        --gzip \
        --to-stdout \
        --file - \
        "./${manifest[media_database_references_file]}" > "$media_database_references_plain"
    chmod 0600 \
      "$s3_quarantine_metadata_plain" \
      "$media_database_references_plain"

    "$SCRIPT_DIR/verify-s3-backup-sidecar.sh" \
      public \
      "$s3_public_metadata_plain" \
      "${manifest[media_public_metadata_sha256]}" \
      "${manifest[media_public_metadata_count]}" \
      "${manifest[media_public_source]}" > "$expected_public_media_paths"
    "$SCRIPT_DIR/verify-s3-backup-sidecar.sh" \
      quarantine \
      "$s3_quarantine_metadata_plain" \
      "${manifest[media_quarantine_metadata_sha256]}" \
      "${manifest[media_quarantine_metadata_count]}" \
      "${manifest[media_quarantine_source]}" > "$expected_quarantine_media_paths"

    public_source_without_scheme="${manifest[media_public_source]#s3://}"
    quarantine_source_without_scheme="${manifest[media_quarantine_source]#s3://}"
    source_public_bucket="${public_source_without_scheme%%/*}"
    source_quarantine_bucket="${quarantine_source_without_scheme%%/*}"
    [[ "$source_public_bucket" != "$source_quarantine_bucket" ]] ||
      { fail "S3 public and quarantine sidecars must use different buckets."; exit 1; }

    actual_references_sha256="$(
      sha256sum "$media_database_references_plain" |
        awk '{print $1}'
    )"
    [[ "$actual_references_sha256" == "${manifest[media_database_references_sha256]}" ]] ||
      { fail "Media database-reference hash does not match the creator-signed manifest."; exit 1; }
    restored_reference_summary="$(
      "$SCRIPT_DIR/verify-media-backup-references.sh" \
        "$media_database_references_plain" \
        "$source_public_bucket" \
        "$source_quarantine_bucket" \
        "$s3_public_metadata_plain" \
        "$s3_quarantine_metadata_plain"
    )"
    IFS='|' read -r \
      restored_public_reference_count \
      restored_quarantine_reference_count \
      restored_unfinished_multipart_count \
      restored_reference_extra \
      <<< "$restored_reference_summary"
    [[ -z "${restored_reference_extra:-}" &&
       "$restored_public_reference_count" == "${manifest[media_database_public_reference_count]}" &&
       "$restored_quarantine_reference_count" == "${manifest[media_database_quarantine_reference_count]}" &&
       "$restored_unfinished_multipart_count" == "${manifest[media_unfinished_multipart_count]}" ]] ||
      { fail "Media database-reference counts do not match the creator-signed manifest."; exit 1; }
  fi
fi

[[ "${manifest[postgres_helper_image]}" == "$postgres_image" ]] ||
  { fail "Manifest PostgreSQL helper image is not in the operator-configured allowlist."; exit 1; }
[[ "${manifest[media_helper_image]}" == "$media_image" ]] ||
  { fail "Manifest media helper image is not in the operator-configured allowlist."; exit 1; }

max_rpo_hours="$(resolved_value RESTORE_MAX_RPO_HOURS "$(resolved_value BACKUP_RPO_HOURS 24)")"
max_rto_hours="$(resolved_value RESTORE_MAX_RTO_HOURS "$(resolved_value BACKUP_RTO_HOURS 4)")"
[[ "$max_rpo_hours" =~ ^[1-9][0-9]*$ && "$max_rto_hours" =~ ^[1-9][0-9]*$ ]] ||
  { fail "RESTORE_MAX_RPO_HOURS and RESTORE_MAX_RTO_HOURS must be positive integers."; exit 1; }
(( ${manifest[rpo_target_hours]} <= max_rpo_hours )) ||
  { fail "Backup RPO target exceeds the restore policy."; exit 1; }
(( ${manifest[rto_target_hours]} <= max_rto_hours )) ||
  { fail "Backup RTO target exceeds the restore policy."; exit 1; }

started_at="$(date -u +%s)"
backup_age_seconds="$(( started_at - ${manifest[created_epoch]} ))"
(( backup_age_seconds >= -300 )) ||
  { fail "Backup creation time is implausibly far in the future."; exit 1; }
(( backup_age_seconds <= max_rpo_hours * 3600 )) ||
  { fail "Backup is older than the configured RPO policy."; exit 1; }

suffix="$(openssl rand -hex 16)"
container="swebudd-restore-db-$suffix"
database_volume="swebudd_restore_db_$suffix"
media_volume="swebudd_restore_media_$suffix"

if docker container inspect "$container" >/dev/null 2>&1 ||
   docker volume inspect "$database_volume" >/dev/null 2>&1 ||
   docker volume inspect "$media_volume" >/dev/null 2>&1; then
  fail "A randomly named restore resource already exists; refusing to continue."
  exit 1
fi

docker volume create \
  --label com.swebudd.restore-drill=true \
  --label "com.swebudd.restore-id=$backup_id" \
  "$database_volume" >/dev/null
database_volume_created=true

docker create \
  --name "$container" \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m,mode=1777 \
  --tmpfs /var/run/postgresql:rw,nosuid,size=8m,mode=3775 \
  --cap-drop ALL \
  --cap-add CHOWN \
  --cap-add DAC_OVERRIDE \
  --cap-add FOWNER \
  --cap-add SETGID \
  --cap-add SETUID \
  --security-opt no-new-privileges:true \
  --pids-limit 128 \
  --label com.swebudd.restore-drill=true \
  --label "com.swebudd.restore-id=$backup_id" \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --env POSTGRES_DB=swebudd_restore \
  --volume "$database_volume:/var/lib/postgresql/data" \
  "$postgres_image" >/dev/null
container_created=true
docker start "$container" >/dev/null

ready=false
for _attempt in $(seq 1 120); do
  if docker exec "$container" \
    pg_isready --username postgres --dbname swebudd_restore >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == "true" ]] ||
  { fail "Isolated restore database did not become ready."; exit 1; }

# The decrypted custom-format dump exists only in the pipe between age and
# pg_restore. It is never written to the host or copied into the container.
age --decrypt --identity "$identity_file" "$backup_dir/database.dump.age" |
  docker exec -i "$container" \
    pg_restore \
      --username postgres \
      --dbname swebudd_restore \
      --no-owner \
      --no-privileges \
      --exit-on-error

database_metadata="$(
  docker exec "$container" \
    psql \
      --username postgres \
      --dbname swebudd_restore \
      --no-psqlrc \
      --tuples-only \
      --no-align \
      --field-separator '|' \
      --set ON_ERROR_STOP=1 \
      --command '
        SELECT
          current_setting('\''server_version_num'\''),
          (SELECT count(*) FROM public."_prisma_migrations"),
          (SELECT count(*) FROM public."users"),
          (SELECT count(*) FROM public."posts"),
          (SELECT count(*) FROM public."groups");
      '
)"
IFS='|' read -r \
  restored_server_version_num \
  restored_migrations_count \
  restored_users_count \
  restored_posts_count \
  restored_groups_count \
  restored_extra <<< "$database_metadata"
[[ -z "${restored_extra:-}" &&
   "$restored_server_version_num" =~ ^[0-9]+$ &&
   "$restored_migrations_count" =~ ^[0-9]+$ &&
   "$restored_users_count" =~ ^[0-9]+$ &&
   "$restored_posts_count" =~ ^[0-9]+$ &&
   "$restored_groups_count" =~ ^[0-9]+$ ]] ||
  { fail "Restored database metadata did not have the expected shape."; exit 1; }
(( restored_server_version_num / 10000 == ${manifest[database_server_version_num]} / 10000 )) ||
  { fail "Restored PostgreSQL major version differs from the source backup."; exit 1; }
[[ "$restored_migrations_count" == "${manifest[database_migrations_count]}" &&
   "$restored_users_count" == "${manifest[database_users_count]}" &&
   "$restored_posts_count" == "${manifest[database_posts_count]}" &&
   "$restored_groups_count" == "${manifest[database_groups_count]}" ]] ||
  { fail "Restored database counts do not match the creator-signed manifest."; exit 1; }

# Validate archive paths and entry types before extraction. Extraction itself
# occurs in a read-only, network-less container whose only writable mount is a
# uniquely labelled drill volume.
age --decrypt --identity "$identity_file" "$backup_dir/media.tar.gz.age" |
  docker run --rm \
    --interactive \
    --network none \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=32m,mode=1777 \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 64 \
    "$media_image" \
    sh -ceu '
      tar -tzf - |
        awk '"'"'
          /^[/]/ || /(^|[/])[.][.]($|[/])/ { exit 1 }
          { count += 1 }
          END { if (count < 1) exit 1 }
        '"'"'
    '

age --decrypt --identity "$identity_file" "$backup_dir/media.tar.gz.age" |
  docker run --rm \
    --interactive \
    --network none \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=32m,mode=1777 \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 64 \
    "$media_image" \
    sh -ceu '
      tar -tvzf - |
        awk '"'"'
          substr($0, 1, 1) != "d" && substr($0, 1, 1) != "-" { exit 1 }
          { count += 1 }
          END { if (count < 1) exit 1 }
        '"'"'
    '

docker volume create \
  --label com.swebudd.restore-drill=true \
  --label "com.swebudd.restore-id=$backup_id" \
  "$media_volume" >/dev/null
media_volume_created=true

restored_media_inventory="$(
  age --decrypt --identity "$identity_file" "$backup_dir/media.tar.gz.age" |
    docker run --rm \
      --interactive \
      --network none \
      --read-only \
      --tmpfs /tmp:rw,noexec,nosuid,size=32m,mode=1777 \
      --cap-drop ALL \
      --security-opt no-new-privileges:true \
      --pids-limit 64 \
      --env "MEDIA_ARCHIVE_LAYOUT=${manifest[media_archive_layout]}" \
      --env "EXPECTED_METADATA_SHA256=${manifest[media_metadata_sha256]}" \
      --env "EXPECTED_PUBLIC_METADATA_SHA256=${manifest[media_public_metadata_sha256]}" \
      --env "EXPECTED_QUARANTINE_METADATA_SHA256=${manifest[media_quarantine_metadata_sha256]}" \
      --env "EXPECTED_REFERENCES_SHA256=${manifest[media_database_references_sha256]}" \
      --env "EMPTY_SHA256=$empty_sha256" \
      --volume "$media_volume:/restore" \
      --volume "$expected_public_media_paths:/run/expected-public-media-paths:ro" \
      --volume "$expected_quarantine_media_paths:/run/expected-quarantine-media-paths:ro" \
      "$media_image" \
      sh -ceu '
        # BusyBox tar -o deliberately ignores archived uid/gid ownership.
        # Extraction therefore works with CHOWN removed and cannot recreate
        # attacker-selected host ownership from a crafted archive.
        tar -xzf - -o -C /restore
        bad_path="$(find /restore -mindepth 1 ! -type d ! -type f -print -quit)"
        [ -z "$bad_path" ] || {
          echo "Extracted media contains a symlink or special file: $bad_path" >&2
          exit 1
        }

        case "$MEDIA_ARCHIVE_LAYOUT" in
          flat-v1)
            inventory_root=/restore
            metadata_sha="$EXPECTED_METADATA_SHA256"
            public_count=0
            public_inventory_sha="$EMPTY_SHA256"
            public_metadata_sha="$EMPTY_SHA256"
            quarantine_count=0
            quarantine_inventory_sha="$EMPTY_SHA256"
            quarantine_metadata_sha="$EMPTY_SHA256"
            references_sha="$EMPTY_SHA256"
            ;;
          s3-single-store-with-metadata-v1)
            [ -d /restore/store ] &&
              [ ! -L /restore/store ] &&
              [ -d /restore/store/objects ] &&
              [ ! -L /restore/store/objects ] &&
              [ -f /restore/store/s3-object-metadata.json ] &&
              [ ! -L /restore/store/s3-object-metadata.json ] || {
                echo "Single-store S3 media archive layout is incomplete." >&2
                exit 1
              }
            [ "$(
              find /restore \
                -mindepth 1 \
                -maxdepth 1 |
                wc -l |
                tr -d "[:space:]"
            )" = 1 ] || {
              echo "Single-store S3 media archive must contain only store/." >&2
              exit 1
            }
            unexpected_store_entry="$(
              find /restore/store \
                -mindepth 1 \
                -maxdepth 1 \
                ! -name objects \
                ! -name s3-object-metadata.json \
                -print -quit
            )"
            [ -z "$unexpected_store_entry" ] || {
              echo "Single S3 store has an unexpected entry." >&2
              exit 1
            }
            [ "$(
              find /restore/store \
                -mindepth 1 \
                -maxdepth 1 |
                wc -l |
                tr -d "[:space:]"
            )" = 2 ] || {
              echo "Single S3 store does not have the exact required layout." >&2
              exit 1
            }

            public_metadata_sha="$(
              sha256sum /restore/store/s3-object-metadata.json |
                awk "{print \$1}"
            )"
            [ "$public_metadata_sha" = "$EXPECTED_PUBLIC_METADATA_SHA256" ] &&
              [ "$public_metadata_sha" = "$EXPECTED_METADATA_SHA256" ] || {
                echo "Extracted S3 metadata sidecar hash differs from the manifest." >&2
                exit 1
              }
            metadata_sha="$public_metadata_sha"
            quarantine_count=0
            quarantine_inventory_sha="$EMPTY_SHA256"
            quarantine_metadata_sha="$EMPTY_SHA256"
            references_sha="$EMPTY_SHA256"

            cd /restore/store/objects
            find . -type f -print | LC_ALL=C sort > /tmp/actual-public-media-paths
            cmp -s /run/expected-public-media-paths /tmp/actual-public-media-paths || {
              echo "Extracted S3 object paths differ from the metadata sidecar." >&2
              exit 1
            }
            public_count="$(find . -type f | wc -l | tr -d "[:space:]")"
            public_inventory_sha="$(
              find . -type f -exec sha256sum {} \; |
                LC_ALL=C sort |
                sha256sum |
                awk "{print \$1}"
            )"
            file_count="$public_count"
            inventory_sha="$public_inventory_sha"
            ;;
          s3-dual-store-with-metadata-v1)
            [ -d /restore/stores ] &&
              [ ! -L /restore/stores ] &&
              [ -d /restore/stores/public/objects ] &&
              [ ! -L /restore/stores/public/objects ] &&
              [ -f /restore/stores/public/s3-object-metadata.json ] &&
              [ ! -L /restore/stores/public/s3-object-metadata.json ] &&
              [ -d /restore/stores/quarantine/objects ] &&
              [ ! -L /restore/stores/quarantine/objects ] &&
              [ -f /restore/stores/quarantine/s3-object-metadata.json ] &&
              [ ! -L /restore/stores/quarantine/s3-object-metadata.json ] &&
              [ -f /restore/media-database-references.json ] &&
              [ ! -L /restore/media-database-references.json ] || {
                echo "Dual-store S3 media archive layout is incomplete." >&2
                exit 1
              }
            unexpected_top="$(
              find /restore \
                -mindepth 1 \
                -maxdepth 1 \
                ! -name stores \
                ! -name media-database-references.json \
                -print -quit
            )"
            [ -z "$unexpected_top" ] || {
              echo "S3 media archive has an unexpected top-level entry." >&2
              exit 1
            }
            unexpected_store="$(
              find /restore/stores \
                -mindepth 1 \
                -maxdepth 1 \
                ! -name public \
                ! -name quarantine \
                -print -quit
            )"
            [ -z "$unexpected_store" ] || {
              echo "S3 media archive has an unexpected store." >&2
              exit 1
            }
            [ "$(
              find /restore/stores \
                -mindepth 1 \
                -maxdepth 1 |
                wc -l |
                tr -d "[:space:]"
            )" = 2 ] || {
              echo "S3 media archive must contain exactly two stores." >&2
              exit 1
            }
            for store in public quarantine; do
              unexpected_store_entry="$(
                find "/restore/stores/$store" \
                  -mindepth 1 \
                  -maxdepth 1 \
                  ! -name objects \
                  ! -name s3-object-metadata.json \
                  -print -quit
              )"
              [ -z "$unexpected_store_entry" ] || {
                echo "$store S3 store has an unexpected entry." >&2
                exit 1
              }
              [ "$(
                find "/restore/stores/$store" \
                  -mindepth 1 \
                  -maxdepth 1 |
                  wc -l |
                  tr -d "[:space:]"
              )" = 2 ] || {
                echo "$store S3 store does not have the exact required layout." >&2
                exit 1
              }
            done

            public_metadata_sha="$(
              sha256sum /restore/stores/public/s3-object-metadata.json |
                awk "{print \$1}"
            )"
            [ "$public_metadata_sha" = "$EXPECTED_PUBLIC_METADATA_SHA256" ] || {
              echo "Extracted public S3 metadata sidecar hash differs from the manifest." >&2
              exit 1
            }
            quarantine_metadata_sha="$(
              sha256sum /restore/stores/quarantine/s3-object-metadata.json |
                awk "{print \$1}"
            )"
            [ "$quarantine_metadata_sha" = "$EXPECTED_QUARANTINE_METADATA_SHA256" ] || {
              echo "Extracted quarantine S3 metadata sidecar hash differs from the manifest." >&2
              exit 1
            }
            metadata_sha="$(
              printf "public=%s\nquarantine=%s\n" \
                "$public_metadata_sha" \
                "$quarantine_metadata_sha" |
                sha256sum |
                awk "{print \$1}"
            )"
            [ "$metadata_sha" = "$EXPECTED_METADATA_SHA256" ] || {
              echo "Extracted combined S3 metadata hash differs from the manifest." >&2
              exit 1
            }
            references_sha="$(
              sha256sum /restore/media-database-references.json |
                awk "{print \$1}"
            )"
            [ "$references_sha" = "$EXPECTED_REFERENCES_SHA256" ] || {
              echo "Extracted media database-reference hash differs from the manifest." >&2
              exit 1
            }

            cd /restore/stores/public/objects
            find . -type f -print | LC_ALL=C sort > /tmp/actual-public-media-paths
            cmp -s /run/expected-public-media-paths /tmp/actual-public-media-paths || {
              echo "Extracted public S3 object paths differ from its metadata sidecar." >&2
              exit 1
            }
            public_count="$(find . -type f | wc -l | tr -d "[:space:]")"
            public_inventory_sha="$(
              find . -type f -exec sha256sum {} \; |
                LC_ALL=C sort |
                sha256sum |
                awk "{print \$1}"
            )"

            cd /restore/stores/quarantine/objects
            find . -type f -print | LC_ALL=C sort > /tmp/actual-quarantine-media-paths
            cmp -s /run/expected-quarantine-media-paths /tmp/actual-quarantine-media-paths || {
              echo "Extracted quarantine S3 object paths differ from its metadata sidecar." >&2
              exit 1
            }
            quarantine_count="$(find . -type f | wc -l | tr -d "[:space:]")"
            quarantine_inventory_sha="$(
              find . -type f -exec sha256sum {} \; |
                LC_ALL=C sort |
                sha256sum |
                awk "{print \$1}"
            )"

            cd /restore
            file_count="$((public_count + quarantine_count))"
            inventory_sha="$(
              find stores/public/objects stores/quarantine/objects -type f -exec sha256sum {} \; |
                LC_ALL=C sort |
                sha256sum |
                awk "{print \$1}"
            )"
            ;;
          *)
            echo "Unsupported media archive layout." >&2
            exit 1
            ;;
        esac

        if [ "$MEDIA_ARCHIVE_LAYOUT" = flat-v1 ]; then
          cd "$inventory_root"
          file_count="$(find . -type f | wc -l | tr -d "[:space:]")"
          inventory_sha="$(
            find . -type f -exec sha256sum {} \; |
              LC_ALL=C sort |
              sha256sum |
              awk "{print \$1}"
          )"
        fi
        printf "%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n" \
          "$file_count" \
          "$inventory_sha" \
          "$metadata_sha" \
          "$public_count" \
          "$public_inventory_sha" \
          "$public_metadata_sha" \
          "$quarantine_count" \
          "$quarantine_inventory_sha" \
          "$quarantine_metadata_sha" \
          "$references_sha"
      '
)"
IFS='|' read -r \
  restored_media_count \
  restored_media_sha \
  restored_metadata_sha \
  restored_public_media_count \
  restored_public_media_sha \
  restored_public_metadata_sha \
  restored_quarantine_media_count \
  restored_quarantine_media_sha \
  restored_quarantine_metadata_sha \
  restored_references_sha \
  restored_media_extra \
  <<< "$restored_media_inventory"
[[ -z "${restored_media_extra:-}" &&
   "$restored_media_count" == "${manifest[media_file_count]}" &&
   "$restored_media_sha" == "${manifest[media_inventory_sha256]}" &&
   "$restored_metadata_sha" == "${manifest[media_metadata_sha256]}" &&
   "$restored_public_media_count" == "${manifest[media_public_file_count]}" &&
   "$restored_public_media_sha" == "${manifest[media_public_inventory_sha256]}" &&
   "$restored_public_metadata_sha" == "${manifest[media_public_metadata_sha256]}" &&
   "$restored_quarantine_media_count" == "${manifest[media_quarantine_file_count]}" &&
   "$restored_quarantine_media_sha" == "${manifest[media_quarantine_inventory_sha256]}" &&
   "$restored_quarantine_metadata_sha" == "${manifest[media_quarantine_metadata_sha256]}" &&
   "$restored_references_sha" == "${manifest[media_database_references_sha256]}" ]] ||
  { fail "Restored media inventory does not match the creator-signed manifest."; exit 1; }

elapsed_seconds="$(( $(date -u +%s) - started_at ))"
(( elapsed_seconds <= max_rto_hours * 3600 )) ||
  { fail "Restore drill exceeded RESTORE_MAX_RTO_HOURS."; exit 1; }
(( elapsed_seconds <= ${manifest[rto_target_hours]} * 3600 )) ||
  { fail "Restore drill exceeded the backup's authenticated RTO target."; exit 1; }

drill_complete=true
echo "Isolated restore drill passed in ${elapsed_seconds}s; exact database counts and media inventory matched."
echo "No production database, production media location, or production schema was modified."
