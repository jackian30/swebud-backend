# SweBudd Backend Release Audit - 0.2.45-beta

Date: 2026-07-16
Release candidate: `0.2.45-beta`
Previous candidate: `0.2.44-beta`

## Scope

This patch retains the complete security, authorization, migration, OpenAPI, and deployment hardening documented for `0.2.44-beta` and fixes the failed Render rollout caused by a stale browser-origin value.

- `FRONTEND_ORIGIN` is pinned to the production Cloudflare Pages origin, `https://swebudd.com`.
- `ADMIN_ORIGIN` is explicitly empty because no public admin deployment exists.
- `NATIVE_APP_ORIGIN=https://localhost` remains the intentional Capacitor WebView origin and is not accepted as a browser origin.
- Production origin validation remains strict and now identifies the exact invalid variable in its startup error.
- Deployment documentation, examples, and the deployment audit enforce the same separation.

## Failure analysis

Render retained `https://localhost` in either `FRONTEND_ORIGIN` or `ADMIN_ORIGIN`. The `0.2.44-beta` security guard correctly rejected that local browser origin and Render rolled back to the healthy `0.2.43-beta` service. The Blueprint now overwrites both browser-origin values instead of inheriting historical dashboard state.

## Verification

- Focused security tests: 13/13 passed.
- Full Jest suite: 43 suites / 438 tests passed.
- Fresh PostgreSQL 16: all 74 migrations applied and migration status reported up to date.
- PostgreSQL security E2E: 1 suite / 7 tests passed against an isolated database.
- ESLint: passed.
- TypeScript/Nest build: passed.
- OpenAPI drift check: passed after regeneration for `0.2.45-beta`.
- Deployment audit: passed, including pinned browser/native origin assertions.
- Render-shaped production configuration smoke: passed.
- Render Blueprint YAML parse and value assertions: passed.
- Bash syntax and `git diff --check`: passed.
- Dependency audit: 0 vulnerabilities.

## Deployment decision

The patch is approved for an annotated `v0.2.45-beta` tag after the staged snapshot and secret scan pass. The public health endpoint must report `0.2.45-beta` after Render completes the deployment; until then, the existing rollback remains the active service.

## Remaining design boundary

New chat messages remain server-readable plaintext until a reviewed per-device key distribution and ratcheting protocol is implemented. This patch does not change that boundary.
