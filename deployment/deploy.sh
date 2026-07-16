#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SWEBUD_ENV_FILE:-$SCRIPT_DIR/.env}"
PROJECT="${COMPOSE_PROJECT_NAME:-swebud}"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE with generated local secrets."
fi

env_value() {
  local key="$1"
  local fallback="${2:-}"
  local value
  value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -1)"
  printf '%s' "${value:-$fallback}"
}

# Docker Compose gives exported variables precedence over --env-file. Validate
# the same effective value that Compose will consume so a one-off shell
# override cannot bypass the production checks below.
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
  temporary="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$temporary"
  mv "$temporary" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

if [[ -z "$(env_value POSTGRES_PASSWORD)" ]]; then
  set_env_value POSTGRES_PASSWORD "$(openssl rand -hex 32)"
fi
if [[ -z "$(env_value DATABASE_URL)" ]]; then
  set_env_value DATABASE_URL "postgresql://$(env_value POSTGRES_USER swebud):$(env_value POSTGRES_PASSWORD)@postgres:5432/$(env_value POSTGRES_DB swebud)?schema=public"
fi
if [[ -z "$(env_value DIRECT_URL)" ]]; then
  set_env_value DIRECT_URL "$(env_value DATABASE_URL)"
fi
if [[ -z "$(env_value JWT_SECRET)" ]]; then
  set_env_value JWT_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
fi
if [[ -z "$(env_value JWT_REFRESH_SECRET)" ]]; then
  set_env_value JWT_REFRESH_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
fi

require_value() {
  local key="$1"
  if [[ -z "$(resolved_value "$key")" ]]; then
    echo "$key is required in $ENV_FILE." >&2
    exit 1
  fi
}

reject_known_secret() {
  local key="$1"
  local value
  value="$(resolved_value "$key")"
  case "${value,,}" in
    ""|password|change-me|change-me-too|change-me-in-production|swebud|dev-jwt-secret-change-me|dev-refresh-secret-change-me|your-*|example-*|test-*|*placeholder*)
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

validate_https_origin_list() {
  local key="$1"
  local value origin authority host lower_host
  value="$(resolved_value "$key")"
  [[ -z "$value" ]] && return 0

  IFS=',' read -r -a origins <<< "$value"
  for origin in "${origins[@]}"; do
    # CORS entries must be origins, not URLs with paths, credentials, queries,
    # or fragments. Whitespace and empty list entries are rejected as well.
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
    if [[ "$lower_host" =~ ^172\.(1[6-9]|2[0-9]|3[01])\. || "$lower_host" =~ ^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\. ]]; then
      echo "Production $key cannot contain localhost or private-network origins." >&2
      exit 1
    fi
  done
}

for key in POSTGRES_PASSWORD DATABASE_URL DIRECT_URL JWT_SECRET JWT_REFRESH_SECRET FRONTEND_ORIGIN; do
  require_value "$key"
done

if [[ "$(resolved_value JWT_SECRET)" == "$(resolved_value JWT_REFRESH_SECRET)" ]]; then
  echo "JWT_SECRET and JWT_REFRESH_SECRET must be different." >&2
  exit 1
fi

MODE="${SWEBUD_MODE:-$(env_value SWEBUD_MODE dev)}"
case "$MODE" in
  dev|local|development)
    COMPOSE_FILE="$SCRIPT_DIR/docker-compose-dev.yml"
    SERVICES=(postgres mailhog backend)
    MODE_LABEL="development"
    export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
    export LOCAL_GID="${LOCAL_GID:-$(id -g)}"
    ;;
  prod|production)
    COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
    SERVICES=(postgres migrate backend)
    MODE_LABEL="production"
    require_value CLOUDFLARE_TURNSTILE_SECRET_KEY
    for key in POSTGRES_PASSWORD JWT_SECRET JWT_REFRESH_SECRET CLOUDFLARE_TURNSTILE_SECRET_KEY; do
      reject_known_secret "$key"
    done
    require_secret_length JWT_SECRET
    require_secret_length JWT_REFRESH_SECRET
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
    if [[ "$(resolved_value SMTP_IGNORE_TLS false)" != "false" || "$(resolved_value SMTP_REQUIRE_TLS true)" != "true" ]]; then
      echo "Production SMTP must require TLS and must not ignore TLS." >&2
      exit 1
    fi
    if [[ "$(resolved_value SMTP_TLS_REJECT_UNAUTHORIZED true)" != "true" ]]; then
      echo "Production SMTP must verify TLS certificates." >&2
      exit 1
    fi
    if [[ "${MAIL_FROM:-$(resolved_value MAIL_FROM)}" =~ [Ll][Oo][Cc][Aa][Ll][Hh][Oo][Ss][Tt] ]]; then
      echo "Production MAIL_FROM must use a verified non-localhost sender." >&2
      exit 1
    fi
    ;;
  *)
    echo "Unknown SWEBUD_MODE '$MODE'. Use 'dev' or 'prod'." >&2
    exit 1
    ;;
esac

NETWORK="$(resolved_value SWEBUD_NETWORK swebud)"
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build --remove-orphans "${SERVICES[@]}"

echo "SweBudd stack is starting:"
echo "- Mode:               $MODE_LABEL"
echo "- Backend container:  http://127.0.0.1:$(env_value BACKEND_PORT 3002)"
echo "- Allowed frontend:   $(resolved_value FRONTEND_ORIGIN http://localhost:9000)"
if [[ "$MODE_LABEL" == "development" ]]; then
  echo "- MailHog:            http://127.0.0.1:$(env_value MAILHOG_UI_PORT 8126)"
else
  echo "- Email:              configured production SMTP (MailHog is not started)"
fi
echo "- Shared network:     $NETWORK"
if [[ "$MODE_LABEL" == "development" ]]; then
  echo "- Container user:     ${LOCAL_UID}:${LOCAL_GID} (matches host; prevents root-owned build files)"
fi
echo "- Compose file:       $COMPOSE_FILE"
echo "Run the frontend/admin deploy scripts from their repos when you need those apps."
