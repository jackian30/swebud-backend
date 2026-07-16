# SweBudd Backend Release Audit - 0.2.48-beta

Date: 2026-07-16
Release candidate: `0.2.48-beta`
Supersedes failed deployment candidates: `0.2.44-beta`, `0.2.45-beta`, `0.2.46-beta`, `0.2.47-beta`

## Scope

The 0.2.47-beta entry-point migration loaded before Nest, but its `RENDER=true` condition did not match the dashboard-managed Docker runtime. The exact historical `FRONTEND_ORIGIN=https://localhost` value therefore reached the unchanged production guard and the deployment correctly stopped.

This patch removes the unreliable provider flag from the narrowly scoped migration:

- The migration runs only when `NODE_ENV=production`.
- It replaces only the exact historical `FRONTEND_ORIGIN=https://localhost` value with `https://swebudd.com` before `AppModule` and `ConfigModule` load.
- It clears only the same exact historical value in the unused `ADMIN_ORIGIN`.
- It preserves `NATIVE_APP_ORIGIN=https://localhost` for Capacitor.
- Development environments remain unchanged.
- Every other malformed, local, private-network, or insecure production browser origin remains unchanged and is rejected by the strict production guard.

The Cloudflare frontend cannot use `https://localhost` as its browser origin, so reverting the HTTPS guard would both weaken production validation and break browser CORS. This exact-value migration fixes the stale deployment state without doing either.

## Verification

- Focused migration/security tests: 2 suites / 17 tests passed.
- Direct compiled-entry smoke without any Render-specific environment flag: passed; the frontend and admin origins were corrected while the native origin was preserved.
- Full Jest suite: 44 suites / 442 tests passed.
- Fresh PostgreSQL 16: all 74 migrations applied and migration status reported up to date.
- Live database to schema and migration history to schema drift checks: no differences.
- PostgreSQL security E2E: 1 suite / 7 tests passed against an isolated database.
- ESLint, TypeScript/Nest build, and OpenAPI drift check: passed.
- Full and production dependency audits: 0 vulnerabilities.
- Dockerfile check/build, deployment audit, Bash syntax, and `git diff --check`: passed.
- Production Docker direct-command smoke without `RENDER`: passed; `/health/live` reported `0.2.48-beta`.
- Production Docker negative smoke: passed; a non-exact invalid browser origin remained unchanged and the strict guard rejected it.
- The complete unit/static/security/deployment gate and isolated 74-migration PostgreSQL/E2E gate passed again unchanged in a second clean-room audit.

## Deployment decision

This candidate is approved for an annotated `v0.2.48-beta` tag only after the final staged snapshot and repeated clean-room audits pass. Deployment is complete only when `https://api.swebudd.com/health/live` reports `0.2.48-beta`.

## Remaining design boundary

New chat messages remain server-readable plaintext until a reviewed per-device key distribution and ratcheting protocol is implemented. This patch does not change that boundary.
