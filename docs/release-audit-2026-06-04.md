# Release Audit - 2026-06-04

Release candidate: `0.2.28-beta`

## Scope

- Backend release for Render/Supabase deploy hardening and login-session history.
- Product database changes are owned by Prisma schema and migration files in this backend repo.
- Frontend `0.2.34-beta` consumes the new session metadata fields.

## Backend Changes

- Added a dedicated `login_sessions` table for visible login history and current-device tracking.
- Linked internal `refresh_tokens` rows to `login_sessions` with `login_session_id`.
- Kept refresh-token rotation auth-internal: refresh creates a new token row but reuses the same visible login session.
- Settings session endpoints now read/revoke `login_sessions` and revoke linked refresh tokens together.
- Logout, password reset, and password change revoke visible login sessions as well as active refresh tokens.
- Captures optional session metadata from request headers: device label, location label, IP address, and user agent.
- Backfilled only active refresh-token rows into `login_sessions`; old revoked refresh-token history is not exposed as login history.
- Preserved Render database startup connection caps for Supabase pooler deployments.
- Bumped backend release metadata to `0.2.28-beta`.

## Migration

- Added Prisma migration:
  - `prisma/migrations/20260603161500_add_login_sessions/migration.sql`
- Local migrate status initially showed the new migration pending.
- `npx prisma migrate deploy` applied it successfully to the local development database.
- Final `npx prisma migrate status` reported the database schema is up to date.

## Validation

- `git diff --check` passed.
- `npm run prisma:generate` passed.
- `npx prisma validate` passed.
- `npm run lint` passed.
- Targeted session tests passed:
  - `npm test -- --runTestsByPath src/auth/auth.service.spec.ts src/users/users.service.spec.ts`: 2 suites, 15 tests.
- Full backend tests passed:
  - `npm test -- --runInBand`: 21 suites, 150 tests.
- `npm run build` passed.
- `npm audit --audit-level=moderate` passed: 0 vulnerabilities.

## Notes

- Location is inferred from trusted proxy/platform headers when available; it is not GPS location.
- If production is behind a proxy that does not forward city/region/country headers, login history will show IP-only or unknown location.
