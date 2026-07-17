# SweBudd Backend Release Audit - 0.2.51-beta

Date: 2026-07-17
Release candidate: `0.2.51-beta`
Supersedes untagged candidate: `0.2.50-beta`
Android pair: `0.2.71-beta` (`50`)

## Scope

The first native-origin hotfix deployed successfully but did not activate because the dashboard-managed Render service name differs from the Blueprint's canonical name.

- Canonical detection still accepts the exact `swebudd-backend` web-service name.
- It now also accepts Render's documented immutable deploy metadata only when all production constraints match: repository `jackian30/swebud-backend`, branch `master`, web-service type, and `IS_PULL_REQUEST=false`.
- Feature branches, pull-request previews, workers, different repositories, non-Render hosts, and compatibility flags cannot enable native auth.
- Runtime normalization and the defense-in-depth startup guard share the same pure identity predicate.

## Verification

- The pre-deploy live gate proves `0.2.50-beta` is healthy but still rejects the native origin, so the failed candidate is not mistaken for a completed fix.
- Focused identity/environment/security tests: 2 suites / 29 tests passed, covering the production-repository fallback and negative preview, branch, worker, missing-metadata, and foreign-repository cases.
- Full Jest suite: 44 suites / 468 tests passed.
- Security E2E against a fresh disposable PostgreSQL 16 database: 10/10 passed after compatible migrations deployed.
- Live-smoke unit tests: 3/3 passed.
- Prisma generate/validate, ESLint, Nest build, OpenAPI generation/drift check, deployment audit, dependency audit, and `git diff --check`: passed.
- Production dependency audit: 0 vulnerabilities.
- The release remains incomplete until the live CORS smoke passes against `0.2.51-beta`.

## Deployment decision

Deploy through the CI-gated `master` branch. Tag only after health reports `0.2.51-beta`, native and web preflights return exact `204` allowlist responses, and the hostile origin remains blocked.
