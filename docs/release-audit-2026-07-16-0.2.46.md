# SweBudd Backend Release Audit - 0.2.46-beta

Date: 2026-07-16
Release candidate: `0.2.46-beta`
Supersedes failed deployment candidates: `0.2.44-beta`, `0.2.45-beta`

## Scope

The Render service is dashboard-managed and retained `FRONTEND_ORIGIN=https://localhost`, so changing the repository Blueprint alone did not update the running service. This patch adds a narrowly scoped startup migration for Render:

- When and only when `RENDER=true` and `FRONTEND_ORIGIN` exactly equals the historical value `https://localhost`, the start wrapper replaces it with `https://swebudd.com` before launching NestJS.
- The same exact historical value in the unused `ADMIN_ORIGIN` is cleared.
- `NATIVE_APP_ORIGIN=https://localhost` remains unchanged for Capacitor.
- Every other malformed, local, private-network, or insecure production browser origin still reaches the strict production guard and fails startup.
- The Blueprint remains pinned to the correct browser origins for future Blueprint-managed services.

## Verification

- Render startup migration tests: 3/3 passed.
- Focused production security tests: passed.
- Full Jest suite: 43 suites / 438 tests passed.
- Fresh PostgreSQL 16: all 74 migrations applied and migration status reported up to date.
- PostgreSQL security E2E: 1 suite / 7 tests passed against an isolated database.
- ESLint, TypeScript/Nest build, and OpenAPI drift check: passed.
- Full and production dependency audits: 0 vulnerabilities.
- Deployment audit, Bash syntax, staged-tree integrity checks, and `git diff --check`: passed.

## Deployment decision

This candidate is approved for an annotated `v0.2.46-beta` tag after the final staged snapshot passes. Deployment is complete only when `https://api.swebudd.com/health/live` reports `0.2.46-beta`.

## Remaining design boundary

New chat messages remain server-readable plaintext until a reviewed per-device key distribution and ratcheting protocol is implemented. This patch does not change that boundary.
