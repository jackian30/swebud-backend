# SweBudd Backend Release Audit - 0.2.50-beta

Date: 2026-07-17
Release candidate: `0.2.50-beta`
Android pair: `0.2.71-beta` (`50`)

## Incident

The installed Android release completed Cloudflare Turnstile but login, registration, and password recovery failed with the browser-level message `Failed to fetch`.

- The shipped AAB correctly uses `https://api.swebudd.com` from the Capacitor origin `https://localhost` and declares `X-SweBudd-Client: native`.
- Production DNS, TLS, Cloudflare proxying, backend health, and database readiness were healthy.
- The live native preflight returned `403 Origin is not allowed`, while the public web origin returned the expected `204`.
- The existing dashboard-managed Render service had not inherited the Blueprint's native-auth values, so Nest omitted the native origin from CORS before the login request could run.

## Fix

- The canonical production Render service now pins `ALLOW_LOCAL_ORIGINS=false`, `NATIVE_AUTH_ENABLED=true`, and `NATIVE_APP_ORIGIN=https://localhost` before Nest reads configuration.
- The pin is restricted to `NODE_ENV=production`, `RENDER=true`, and `RENDER_SERVICE_NAME=swebudd-backend`. Compatibility flags, preview services, self-hosted services, and development cannot activate it.
- `SWEBUDD_NATIVE_AUTH_EMERGENCY_DISABLED=true` provides a separate, validated native CORS/session-transport shutdown. It does not replace token revocation or secret rotation during credential incidents.
- Production startup validates the canonical Render native profile as defense in depth.
- A reusable live CORS smoke checks readiness/version, native and web allowlists, required credential/header behavior, and hostile-origin rejection.

## Verification

- Focused Render/security tests: 2 suites / 27 tests passed.
- Full Jest suite: 44 suites / 466 tests passed.
- Security E2E against a fresh disposable PostgreSQL 16 database: 10/10 passed after all compatible migrations deployed.
- Live-smoke script unit tests: 3/3 passed and reproduced the pre-deploy production `https://localhost` 403 failure.
- Prisma generate/validate, ESLint, TypeScript/Nest build, OpenAPI generation/drift check, deployment audit, dependency audit, and `git diff --check`: passed.
- Production dependency audit: 0 vulnerabilities.

## Deployment decision

Push `master` so GitHub CI can gate Render auto-deployment. Deployment is complete only when:

1. `https://api.swebudd.com/health/ready` reports `0.2.50-beta` with database status `ok`.
2. Native and web login preflights return `204` with their exact allowed origins and credentials enabled.
3. A hostile origin remains `403` without `Access-Control-Allow-Origin`.
4. Login and refresh recovery work on the existing signed Android `0.2.71-beta` build.

The Android AAB does not need to be rebuilt for this server-side CORS incident.

## Deployment result

GitHub CI passed and Render served `0.2.50-beta`, but the mandatory live smoke still returned `403` for `https://localhost`. The dashboard service's actual `RENDER_SERVICE_NAME` differs from the Blueprint name, so the name-only canonical predicate did not activate. This candidate was not tagged and is superseded by `0.2.51-beta`.
