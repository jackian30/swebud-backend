# SweBudd Backend Release Audit - 0.2.36-beta

Date: 2026-06-12
Release candidate: `0.2.36-beta`
Frontend pair: `0.2.50-beta`

## Scope

- Buddy-session direct invite messages now include internal room/code data.
- Backend no longer appends client-provided invite URLs to buddy-session invite messages.
- Local development Compose ports for backend, Postgres, and MailHog are bound through `BACKEND_BIND_ADDRESS`.
- Frontend continues to reach the backend through the shared Docker network.

## Verification

- `npm run prisma:generate`: passed.
- `npx prisma validate`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm test -- --runInBand`: passed, 22 suites / 157 tests.
- `npm audit --audit-level=high`: passed, 0 vulnerabilities.

## Security Notes

- Direct backend, Postgres, and MailHog ports are localhost-only in the active local deployment.
- Secret scan found no matching backend source secrets outside ignored local env/upload paths.
