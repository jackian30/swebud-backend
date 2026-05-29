# Release Audit 2026-05-29

Release candidate: `0.2.22-beta`

## Scope

- Backend email reliability and SMTP configuration hardening after `v0.2.21-beta`.
- Version/readme alignment for the backend release.
- Chat/E2EE documentation refresh so the frontend in-app explanation matches the backend contract.

## Changes Audited

- Password reset email dispatch no longer blocks the forgot-password response path.
- Nodemailer SMTP transport supports explicit TLS/auth flags, connection/greeting/socket timeouts, and IP family selection.
- Local email still defaults to MailHog with plaintext local delivery.
- No Prisma schema or migration changes are included in this release.

## Verification

- `git diff --check` passed.
- `npm run build` passed.
- `npm run lint` passed.
- `npm test -- --runInBand` passed: 21 suites, 141 tests.
- `npx prisma validate` passed.
- `npx prisma migrate status` passed against local Postgres; schema is up to date.
- `npm audit --audit-level=high` passed with 0 vulnerabilities.

## Residual Risks

- Production email still depends on provider DNS/auth setup and correct SMTP env values.
- Mailgun REST delivery is not implemented in this release; Mailgun can still be used through its SMTP credentials.
- Broader browser/mobile end-to-end coverage remains needed before a production launch.

## Decision

Ready to tag and push as `v0.2.22-beta`.
