# SweBudd Backend Release Audit - 0.2.47-beta

Date: 2026-07-16
Release candidate: `0.2.47-beta`
Supersedes failed deployment candidates: `0.2.44-beta`, `0.2.45-beta`, `0.2.46-beta`

## Scope

The dashboard-managed Render Docker service launches `dist/src/main.js` directly, bypassing both the image command and the Render start wrapper. That left the historical dashboard value `FRONTEND_ORIGIN=https://localhost` unchanged in 0.2.46-beta and the strict production guard correctly stopped the deployment.

This patch moves the narrowly scoped compatibility migration into the first module imported by the compiled application entry point:

- When and only when `RENDER=true` and `FRONTEND_ORIGIN` exactly equals the historical value `https://localhost`, it is replaced with `https://swebudd.com` before `AppModule` and `ConfigModule` load.
- The same exact historical value in the unused `ADMIN_ORIGIN` is cleared.
- `NATIVE_APP_ORIGIN=https://localhost` remains unchanged for Capacitor.
- Every other malformed, local, private-network, or insecure production browser origin still reaches the strict production guard and fails startup.
- The migration is now effective whether Render uses the Docker image command, `npm start`, or a direct `node dist/src/main.js` dashboard override.

## Verification

- Compiled direct-entry smoke test: passed; the environment was normalized before the compiled `AppModule` import.
- Production Docker direct-command smoke: passed against PostgreSQL 16 with the exact stale Render browser-origin values; the container started and `/health/live` reported `0.2.47-beta`.
- Render environment compatibility tests: 4/4 passed.
- Render database start-wrapper tests: 3/3 passed.
- Focused production security tests: passed.
- Full Jest suite: 44 suites / 442 tests passed.
- Fresh PostgreSQL 16: all 74 migrations applied and migration status reported up to date.
- Live database to schema and migration history to schema drift checks: no differences.
- PostgreSQL security E2E: 1 suite / 7 tests passed against an isolated database.
- ESLint, TypeScript/Nest build, and OpenAPI drift check: passed.
- Full and production dependency audits: 0 vulnerabilities.
- Dockerfile check/build, deployment audit, Bash syntax, compiled-entry ordering, and `git diff --check`: passed.
- The complete unit/static/security/deployment gate and the isolated migration/E2E gate passed again unchanged in a second clean-room audit.

## Deployment decision

This candidate is approved for an annotated `v0.2.47-beta` tag only after the final staged snapshot and repeated clean-room audits pass. Deployment is complete only when `https://api.swebudd.com/health/live` reports `0.2.47-beta`.

## Remaining design boundary

New chat messages remain server-readable plaintext until a reviewed per-device key distribution and ratcheting protocol is implemented. This patch does not change that boundary.
