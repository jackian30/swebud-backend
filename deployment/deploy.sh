#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE. Review secrets before production use."
fi

docker compose --env-file "$ENV_FILE" -f "$SCRIPT_DIR/docker-compose.yml" up -d --build postgres mailhog backend frontend

echo "SweBud stack is starting:"
echo "- Frontend: http://localhost:${FRONTEND_PORT:-9000}"
echo "- Backend:  http://localhost:${BACKEND_PORT:-3000}"
echo "- MailHog:  http://localhost:${MAILHOG_UI_PORT:-8026}"
