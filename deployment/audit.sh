#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$SCRIPT_DIR/.env.example"
fi

prod="$(mktemp)"
dev="$(mktemp)"
audit_env="$(mktemp)"
failure="$(mktemp)"
cleanup() { rm -f "$prod" "$dev" "$audit_env" "$failure"; }
trap cleanup EXIT

cp "$SCRIPT_DIR/.env.example" "$audit_env"

audit_environment=(
  POSTGRES_PASSWORD=audit-postgres-random-value
  DATABASE_URL=postgresql://audit:audit-postgres-random-value@postgres:5432/audit?schema=public
  DIRECT_URL=postgresql://audit:audit-postgres-random-value@postgres:5432/audit?schema=public
  JWT_SECRET=audit-access-secret-with-more-than-32-characters
  JWT_REFRESH_SECRET=audit-refresh-secret-with-more-than-32-characters
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
)

env "${audit_environment[@]}" docker compose -p swebud-audit --env-file "$ENV_FILE" -f "$SCRIPT_DIR/docker-compose.yml" config > "$prod"
env "${audit_environment[@]}" docker compose -p swebud-audit --env-file "$ENV_FILE" -f "$SCRIPT_DIR/docker-compose-dev.yml" config > "$dev"

if grep -q '^  mailhog:' "$prod"; then
  echo "Production Compose unexpectedly includes MailHog." >&2
  exit 1
fi
postgres_section="$(sed -n '/^  postgres:/,/^  [a-z]/p' "$prod")"
if grep -q 'published:' <<< "$postgres_section"; then
  echo "Production PostgreSQL unexpectedly publishes a host port." >&2
  exit 1
fi
grep -q 'read_only: true' "$prod"
grep -q 'no-new-privileges:true' "$prod"
grep -q 'host_ip: 127.0.0.1' "$dev"
grep -q '^  mailhog:' "$dev"
grep -q 'deployment/Dockerfile.dev' "$SCRIPT_DIR/docker-compose-dev.yml"
grep -q "^USER \${LOCAL_UID}:\${LOCAL_GID}$" "$SCRIPT_DIR/Dockerfile.dev"
if grep -q 'apk add' <(sed -n '/^[[:space:]]*command:/,/^[[:space:]]*ports:/p' "$SCRIPT_DIR/docker-compose-dev.yml"); then
  echo "Development startup command installs packages at runtime." >&2
  exit 1
fi
bash -n "$SCRIPT_DIR/deploy.sh"

# All production validation completes before the deploy script inspects or
# creates a Docker network.
mode_validation_end="$(grep -n '^esac$' "$SCRIPT_DIR/deploy.sh" | tail -1 | cut -d: -f1)"
network_operation="$(grep -n '^docker network inspect' "$SCRIPT_DIR/deploy.sh" | cut -d: -f1)"
(( network_operation > mode_validation_end ))

# The hosted blueprint must request environment-specific production values
# instead of embedding a real storage project or an unsafe local mail sender.
if grep -q 'supabase\.co/storage\|no-reply@localhost' "$SCRIPT_DIR/../render.yaml"; then
  echo "Render blueprint embeds a production storage identifier or localhost sender." >&2
  exit 1
fi
for key in CLOUDFLARE_TURNSTILE_SECRET_KEY MEDIA_S3_BUCKET MEDIA_PUBLIC_BASE_URL AWS_S3_ENDPOINT MAIL_FROM; do
  grep -A1 -- "- key: $key" "$SCRIPT_DIR/../render.yaml" | grep -q 'sync: false'
done
# Browser origins are public, non-secret deployment values. Keep the deployed
# Cloudflare origin pinned and explicitly clear the unused admin origin so an
# existing Render service cannot retain a historical localhost value.
grep -A1 -- '- key: FRONTEND_ORIGIN' "$SCRIPT_DIR/../render.yaml" | grep -q 'value: https://swebudd.com'
grep -A1 -- '- key: ADMIN_ORIGIN' "$SCRIPT_DIR/../render.yaml" | grep -q 'value: ""'
if sed -n '/- key: FRONTEND_ORIGIN/,+1p; /- key: ADMIN_ORIGIN/,+1p' "$SCRIPT_DIR/../render.yaml" | grep -q 'localhost'; then
  echo "Render blueprint configures a public browser origin as localhost." >&2
  exit 1
fi
grep -A1 -- '- key: NATIVE_AUTH_ENABLED' "$SCRIPT_DIR/../render.yaml" | grep -q 'value: "true"'
grep -A1 -- '- key: NATIVE_APP_ORIGIN' "$SCRIPT_DIR/../render.yaml" | grep -q 'value: https://localhost'
node --test "$SCRIPT_DIR/../scripts/render-start.test.js"
if [[ "$(head -n 1 "$SCRIPT_DIR/../src/main.ts")" != "import './common/render-environment';" ]]; then
  echo "Render environment migration is not the first backend bootstrap import." >&2
  exit 1
fi
grep -q 'normalizeLegacyRenderBrowserOrigins();' "$SCRIPT_DIR/../src/common/render-environment.ts"

# Production validation must inspect shell overrides exactly as Compose does.
# These cases exit before any Docker operation.
if env "${audit_environment[@]}" \
  SWEBUD_ENV_FILE="$audit_env" SWEBUD_MODE=prod \
  FRONTEND_ORIGIN='https://swebudd.example,http://insecure.example' \
  "$SCRIPT_DIR/deploy.sh" >"$failure" 2>&1; then
  echo "Production accepted an insecure origin list." >&2
  exit 1
fi
grep -q 'HTTPS origins only' "$failure"

if env "${audit_environment[@]}" \
  SWEBUD_ENV_FILE="$audit_env" SWEBUD_MODE=prod \
  JWT_SECRET='too-short' \
  "$SCRIPT_DIR/deploy.sh" >"$failure" 2>&1; then
  echo "Production accepted a short JWT secret." >&2
  exit 1
fi
grep -q 'at least 32 characters' "$failure"

if env "${audit_environment[@]}" \
  SWEBUD_ENV_FILE="$audit_env" SWEBUD_MODE=prod \
  CLOUDFLARE_TURNSTILE_SECRET_KEY='' \
  "$SCRIPT_DIR/deploy.sh" >"$failure" 2>&1; then
  echo "Production accepted an empty Turnstile secret." >&2
  exit 1
fi
grep -q 'CLOUDFLARE_TURNSTILE_SECRET_KEY is required' "$failure"

if env "${audit_environment[@]}" \
  SWEBUD_ENV_FILE="$audit_env" SWEBUD_MODE=prod \
  SMTP_HOST='LOCALHOST' \
  "$SCRIPT_DIR/deploy.sh" >"$failure" 2>&1; then
  echo "Production accepted a local SMTP server." >&2
  exit 1
fi
grep -q 'production mail service' "$failure"

if env "${audit_environment[@]}" \
  SWEBUD_ENV_FILE="$audit_env" SWEBUD_MODE=prod \
  SMTP_TLS_REJECT_UNAUTHORIZED=false \
  "$SCRIPT_DIR/deploy.sh" >"$failure" 2>&1; then
  echo "Production accepted disabled SMTP certificate verification." >&2
  exit 1
fi
grep -q 'verify TLS certificates' "$failure"

echo "Backend deployment security audit passed."
