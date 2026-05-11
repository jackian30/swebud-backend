# Release Audit - 2026-05-11

Target reviewed: SweBud beta release stack, including backend, frontend, admin, database migrations, and Docker Compose deployment.

## Result

Release checks are passing for the local beta stack after fixes in this audit.

## Fixed During Audit

- Admin Docker Compose config was still wired like the old Nuxt admin and mapped the wrong internal port. It now provides Laravel runtime env, uses the Laravel admin port, and has a healthcheck.
- Admin deployment env example now includes `ADMIN_APP_KEY`, `ADMIN_APP_URL`, `ADMIN_API_BASE_URL`, and `ADMIN_PORT`.
- Local deployment env now includes an admin app key so the admin container can boot.
- Admin database browser now redacts sensitive fields server-side instead of only hiding them in Vue.
- Admin generic database edits now reject sensitive fields such as password hashes, token hashes, chat public keys, nonces, and ciphertext.
- Admin database table list now includes the normalized `userActivityPersona` relation.
- Backend lint warning from the activity-persona normalization was removed.

## Verification

- Backend tests: 17 suites, 101 tests passed.
- Backend build: passed.
- Backend lint: passed.
- Backend production dependency audit: 0 vulnerabilities.
- Prisma migration status: database schema up to date.
- Frontend tests: 9 files, 34 tests passed.
- Frontend SPA build: passed, with existing bundle-size/plugin timing warnings.
- Frontend production dependency audit: 0 vulnerabilities.
- Admin Vite build: passed.
- Admin production dependency audit: 0 vulnerabilities.
- Admin Composer audit: no security advisories found.
- Admin Docker image build: passed.
- Running containers: backend, frontend, admin, postgres, and mailhog healthy/running.
- Admin login API smoke: `POST /auth/admin-login` returned 200 and `/admin/me` returned 200 with the issued token.
- Admin web smoke: `/login` returned 200 and includes the configured API base URL.

## Remaining Release Risks

- Composer and PHP are not installed on the host, so `php artisan test` could not be run locally. The admin Docker image builds and boots, but PHPUnit should be run in a dev/test image that includes dev dependencies.
- The frontend build still emits large chunk warnings, mostly from map and framework bundles. This is not a blocker for beta, but route-level splitting should be revisited.
- The admin database editor is intentionally powerful. Sensitive field redaction is now server-side, but production access should still be restricted to trusted admins only.
- Current release metadata in the app is `0.1.4-beta`. If the desired release is `0.1.0-beta`, version constants and package metadata need a separate coordinated version change.
