#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
PROJECT="${COMPOSE_PROJECT_NAME:-swebud}"
MODE="${SWEBUD_MODE:-dev}"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE. Review secrets before production use."
fi

env_value() {
  local key="$1"
  local fallback="$2"
  local value
  value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -1)"
  echo "${value:-$fallback}"
}

NETWORK="$(env_value SWEBUD_NETWORK swebud)"
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

case "$MODE" in
  dev|local|development)
    COMPOSE_FILE="$SCRIPT_DIR/docker-compose-dev.yml"
    SERVICES=(postgres mailhog backend)
    MODE_LABEL="development"
    ;;
  prod|production)
    COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
    SERVICES=(postgres mailhog migrate backend)
    MODE_LABEL="production"
    ;;
  *)
    echo "Unknown SWEBUD_MODE '$MODE'. Use 'dev' or 'prod'." >&2
    exit 1
    ;;
esac

docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build "${SERVICES[@]}"

echo "SweBudd stack is starting:"
echo "- Mode:               $MODE_LABEL"
echo "- Backend container:  http://localhost:$(env_value BACKEND_PORT 3002)"
echo "- Allowed frontend:   $(env_value FRONTEND_ORIGIN http://localhost:9000)"
echo "- MailHog:            http://localhost:$(env_value MAILHOG_UI_PORT 8126)"
echo "- Shared network:     $NETWORK"
echo "- Compose file:       $COMPOSE_FILE"
echo "Run the frontend/admin deploy scripts from their repos when you need those apps."
