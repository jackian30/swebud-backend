# SweBudd Backend Release Audit - 0.2.30-beta

Date: 2026-06-06
Release candidate: `0.2.30-beta`

## Scope

- Adds comma-separated feed hashtag filtering support, such as `hashtag=run,pilates`.
- Changes multi-hashtag feed matching to AND logic, so every selected hashtag must exist on the post.
- Keeps existing single-hashtag filtering behavior compatible.
- Adds feed service coverage for multi-hashtag AND filtering.

## Gates

- Sub-agent backend audit completed with no blocking findings.
- `npx prisma validate` passed.
- `npm test` passed: 21 suites, 151 tests.
- `npm run lint` passed.
- `npm run build` passed.
- `git diff --check` passed before release packaging.
- Local pre-release health smoke was reachable:
  - `GET http://localhost:3002/health/live`
  - `GET http://localhost:3002/health/ready`

## Deployment Notes

- This backend release pairs with frontend `0.2.42-beta`.
- Render has auto-deploy enabled, so pushing `master` can start deployment.
- Production still requires correct `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, and frontend origin settings.
