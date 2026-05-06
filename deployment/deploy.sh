#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE. Review secrets before production use."
fi

docker compose --env-file "$ENV_FILE" -f "$SCRIPT_DIR/docker-compose.yml" up -d --build postgres mailhog backend frontend

env_value() {
  local key="$1"
  local fallback="$2"
  local value
  value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -1)"
  echo "${value:-$fallback}"
}

echo "SweBud stack is starting:"
echo "- Frontend container: http://localhost:$(env_value FRONTEND_PORT 9000)"
echo "- Backend container:  http://localhost:$(env_value BACKEND_PORT 3000)"
echo "- API base:           $(env_value API_BASE_URL /api)"
echo "- Allowed frontend:   $(env_value FRONTEND_ORIGIN http://localhost:9000)"
echo "- MailHog:            http://localhost:$(env_value MAILHOG_UI_PORT 8026)"
