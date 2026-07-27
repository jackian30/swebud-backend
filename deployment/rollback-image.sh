#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if (( $# != 1 )); then
  echo "Usage: $0 sha256:<expected-previous-image-id>" >&2
  exit 1
fi

[[ "$(uname -s)" == "Linux" ]] || {
  echo "deployment/rollback-image.sh supports Linux hosts only." >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SWEBUD_ENV_FILE:-$SCRIPT_DIR/.env}"
STATE_DIR="$SCRIPT_DIR/.deployment-state"
PROJECT="${COMPOSE_PROJECT_NAME:-swebud}"
EXPECTED_IMAGE_ID="$1"

[[ "$EXPECTED_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || {
  echo "The expected previous image must be a full immutable sha256 image ID." >&2
  exit 1
}
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || {
  echo "Environment file must be a non-symlink regular file: $ENV_FILE" >&2
  exit 1
}
[[ -d "$STATE_DIR" && ! -L "$STATE_DIR" ]] || {
  echo "Deployment state directory is missing or unsafe: $STATE_DIR" >&2
  exit 1
}

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

parse_state() {
  local state_file="$1"
  local destination_name="$2"
  local -n destination="$destination_name"
  local -A allowed=(
    [format]=1
    [deploy_id]=1
    [deployed_at_utc]=1
    [project]=1
    [git_commit]=1
    [backend_image_ref]=1
    [backend_image_id]=1
    [backend_repo_digests]=1
    [compose_sha256]=1
    [migration_count]=1
    [migration_state_sha256]=1
    [pre_migration_backup_dir]=1
  )
  local key value

  [[ -f "$state_file" && ! -L "$state_file" ]] || {
    echo "Deployment state file is missing or unsafe: $state_file" >&2
    return 1
  }
  destination=()
  while IFS='=' read -r key value || [[ -n "$key$value" ]]; do
    [[ "$key" =~ ^[a-z][a-z0-9_]*$ && -v "allowed[$key]" ]] || {
      echo "Unexpected key '$key' in $state_file." >&2
      return 1
    }
    [[ ! -v "destination[$key]" && -n "$value" && "$value" != *$'\n'* ]] || {
      echo "Duplicate or invalid key '$key' in $state_file." >&2
      return 1
    }
    destination["$key"]="$value"
  done < "$state_file"
  (( ${#destination[@]} == ${#allowed[@]} )) || {
    echo "Deployment state does not contain the exact required key set: $state_file" >&2
    return 1
  }
  [[ "${destination[format]}" == "swebudd-deployment-state-v1" ]] || {
    echo "Unsupported deployment state format." >&2
    return 1
  }
  [[ "${destination[backend_image_id]}" =~ ^sha256:[a-f0-9]{64}$ ]] || {
    echo "Deployment state contains an invalid image ID." >&2
    return 1
  }
}

mode="$(resolved_value SWEBUD_MODE dev)"
case "$mode" in
  prod|production) ;;
  *)
    echo "Image rollback is restricted to SWEBUD_MODE=prod." >&2
    exit 1
    ;;
esac

if [[ "$(resolved_value ROLLBACK_SCHEMA_COMPATIBILITY_ACK)" != "I_HAVE_VERIFIED_BACKWARD_COMPATIBILITY" ]]; then
  echo "Set ROLLBACK_SCHEMA_COMPATIBILITY_ACK=I_HAVE_VERIFIED_BACKWARD_COMPATIBILITY after reviewing the applied migrations." >&2
  echo "This script never downgrades the database schema." >&2
  exit 1
fi

failure_hook="$(resolved_value FAILURE_ALERT_HOOK)"
[[ "$failure_hook" == /* && -f "$failure_hook" && -x "$failure_hook" && ! -L "$failure_hook" ]] || {
  echo "FAILURE_ALERT_HOOK must be an absolute executable, non-symlink file." >&2
  exit 1
}

declare -A current_state=()
declare -A target_state=()
parse_state "$STATE_DIR/current.env" current_state
parse_state "$STATE_DIR/previous.env" target_state

[[ "${current_state[project]}" == "$PROJECT" &&
   "${target_state[project]}" == "$PROJECT" ]] || {
  echo "Deployment state project does not match COMPOSE_PROJECT_NAME." >&2
  exit 1
}
[[ "${target_state[backend_image_id]}" == "$EXPECTED_IMAGE_ID" ]] || {
  echo "The explicit image ID does not match the recorded previous deployment." >&2
  exit 1
}
[[ "${current_state[backend_image_id]}" != "$EXPECTED_IMAGE_ID" ]] || {
  echo "The requested previous image is already current." >&2
  exit 1
}

actual_target_id="$(
  docker image inspect --format '{{.Id}}' "$EXPECTED_IMAGE_ID" 2>/dev/null || true
)"
[[ "$actual_target_id" == "$EXPECTED_IMAGE_ID" ]] || {
  echo "The recorded previous image is not available locally by immutable ID." >&2
  exit 1
}

compose=(
  docker compose
  -p "$PROJECT"
  --env-file "$ENV_FILE"
  -f "$SCRIPT_DIR/docker-compose.yml"
)
current_container="$("${compose[@]}" ps -q backend)"
[[ -n "$current_container" ]] || {
  echo "No running Compose backend container was found." >&2
  exit 1
}
running_image_id="$(docker inspect --format '{{.Image}}' "$current_container")"
[[ "$running_image_id" == "${current_state[backend_image_id]}" ]] || {
  echo "Running backend image does not match current.env; refusing rollback." >&2
  exit 1
}

rollback_complete=false

send_failure_alert() {
  local exit_code="$1"
  SWEBUDD_ALERT_EVENT="image_rollback_failed" \
  SWEBUDD_ALERT_EXIT_CODE="$exit_code" \
  SWEBUDD_ALERT_PROJECT="$PROJECT" \
  SWEBUDD_ALERT_IMAGE_ID="$EXPECTED_IMAGE_ID" \
    "$failure_hook" || echo "Failure alert hook also failed." >&2
}

recover_current_image() {
  local recovery_tag
  echo "Attempting to restore the pre-rollback image." >&2
  recovery_tag="swebud-backend:rollback-recovery-${current_state[backend_image_id]#sha256:}"
  recovery_tag="${recovery_tag:0:80}"
  docker image tag "${current_state[backend_image_id]}" "$recovery_tag" || return 1
  export BACKEND_IMAGE="$recovery_tag"
  "${compose[@]}" up \
    -d \
    --no-deps \
    --no-build \
    --force-recreate \
    --wait \
    --wait-timeout 180 \
    backend
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ "$exit_code" -ne 0 || "$rollback_complete" != "true" ]]; then
    send_failure_alert "$exit_code"
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

rollback_tag="swebud-backend:rollback-${EXPECTED_IMAGE_ID#sha256:}"
rollback_tag="${rollback_tag:0:80}"
docker image tag "$EXPECTED_IMAGE_ID" "$rollback_tag"
export BACKEND_IMAGE="$rollback_tag"

if ! "${compose[@]}" up \
  -d \
  --no-deps \
  --no-build \
  --force-recreate \
  --wait \
  --wait-timeout 180 \
  backend; then
  echo "Previous image failed readiness." >&2
  recover_current_image || true
  exit 1
fi

rolled_back_container="$("${compose[@]}" ps -q backend)"
rolled_back_image_id="$(docker inspect --format '{{.Image}}' "$rolled_back_container")"
rolled_back_health="$(
  docker inspect \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "$rolled_back_container"
)"
[[ "$rolled_back_image_id" == "$EXPECTED_IMAGE_ID" &&
   ( "$rolled_back_health" == "healthy" || "$rolled_back_health" == "none" ) ]] || {
  echo "Rollback container did not pass immutable-image/readiness verification." >&2
  recover_current_image || true
  exit 1
}

rollback_id="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 8)"
rollback_repo_digests="$(
  docker image inspect --format '{{join .RepoDigests ","}}' "$EXPECTED_IMAGE_ID"
)"
compose_sha256="$(
  "${compose[@]}" config |
    sha256sum |
    awk '{print $1}'
)"

old_current_temporary="$(mktemp "$STATE_DIR/.previous.XXXXXXXX")"
new_current_temporary="$(mktemp "$STATE_DIR/.current.XXXXXXXX")"
cp "$STATE_DIR/current.env" "$old_current_temporary"
{
  echo "format=swebudd-deployment-state-v1"
  echo "deploy_id=rollback-$rollback_id"
  echo "deployed_at_utc=$(date -u +%Y%m%dT%H%M%SZ)"
  echo "project=$PROJECT"
  echo "git_commit=${target_state[git_commit]}"
  echo "backend_image_ref=$rollback_tag"
  echo "backend_image_id=$EXPECTED_IMAGE_ID"
  echo "backend_repo_digests=${rollback_repo_digests:-none}"
  echo "compose_sha256=$compose_sha256"
  echo "migration_count=${current_state[migration_count]}"
  echo "migration_state_sha256=${current_state[migration_state_sha256]}"
  echo "pre_migration_backup_dir=${current_state[pre_migration_backup_dir]}"
} > "$new_current_temporary"
chmod 0600 "$old_current_temporary" "$new_current_temporary"
mv -- "$old_current_temporary" "$STATE_DIR/previous.env"
mv -- "$new_current_temporary" "$STATE_DIR/current.env"

rollback_complete=true
echo "Backend image rollback passed readiness verification."
echo "Current image: $EXPECTED_IMAGE_ID"
echo "Database schema was not changed or downgraded."
