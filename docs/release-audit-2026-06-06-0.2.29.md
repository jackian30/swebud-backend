# SweBudd Backend Release Audit - 0.2.29-beta

Date: 2026-06-06
Release candidate: `0.2.29-beta`

## Scope

- Adds `user_search_history` persistence for authenticated account-backed recent search.
- Adds `/users/me/search-history` list, save/update, remove one, and clear-all endpoints.
- Includes Prisma migration `20260606162500_add_user_search_history`.

## Gates

- `npm test` passed: 21 suites, 150 tests.
- `npm run lint` passed.
- `npm run build` passed.
- `npx prisma validate` passed.
- Local and deployed Prisma migration status reported the database schema up to date.
- `GET http://localhost:3002/health` returned OK.

## Deployment Notes

- The deployed local Docker stack was restored after frontend redeploy pruning.
- Backend, Postgres, and MailHog containers were healthy before release packaging.
