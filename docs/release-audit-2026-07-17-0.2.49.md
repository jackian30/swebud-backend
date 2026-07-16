# SweBudd Backend Release Audit - 0.2.49-beta

Date: 2026-07-17
Release candidate: `0.2.49-beta`
Supersedes failed deployment candidates: `0.2.44-beta` through `0.2.48-beta`

## Scope

This candidate makes the cookie-authentication and deployment hardening rollout compatible with existing web and Android installations while retaining strict production browser-origin validation.

- Capacitor requests from the exact configured `https://localhost` WebView origin remain compatible with Android releases that predate the native-client header.
- Modern native requests still declare their transport explicitly, and native-header requests from every other origin are rejected.
- Existing web refresh tokens receive a bounded, exact-origin one-request migration bridge. Cookie-only requests stay in web mode and never expose refresh tokens in JSON.
- Native upgrade migration stages the legacy token in secure storage, preserves recoverable credentials on transient failures, and clears them only after definitive authentication rejection.
- The legacy Android login/signup CAPTCHA exception is bounded by a cutoff and the authentication rate limiter. This is a temporary compatibility tradeoff because older clients have no cryptographic attestation signal.
- Database changes use an expand/contract rollout. Premature destructive migrations are recorded without applying contract SQL, and the rollback compatibility column is restored before the current service starts.
- Message-request creation and acceptance share a transaction-scoped PostgreSQL advisory lock while the final unique index remains deferred.
- The Docker entrypoint prepares and deploys migrations even when Render overrides the image command with `node dist/src/main.js`.
- Render origin normalization is limited to the intended production service or an explicit compatibility flag.

## Verification

- Full Jest suite: 44 suites / 460 tests passed.
- Fresh PostgreSQL deployment: compatibility preparation plus all applicable Prisma migrations passed.
- Security E2E: 10 tests passed against an isolated freshly migrated database.
- Rollback proof: current migrations followed by a real `0.2.43-beta` migration deployment succeeded; `users.chat_private_key` remained present and the deferred incompatible unique index remained absent.
- Prisma generate/validate, ESLint, TypeScript no-emit, Nest build, OpenAPI drift check, and `git diff --check`: passed.
- Production dependency audit: 0 vulnerabilities.
- Docker image build and direct Render-command smoke: passed; the service ran migrations and reported readiness as `0.2.49-beta`.
- Deployment audit, entrypoint tests, migration-preparation tests, conflict scan, and secret scan: passed.

## Compatibility boundaries

- Logged-out Android releases without CAPTCHA support use a temporary exact-origin compatibility exception through 2026-10-01, limited to 12 authentication requests per IP per minute. Origin is not device attestation, so the exception must be removed at the cutoff.
- Cached web clients can migrate their body refresh token during the bounded legacy window. Current cookie clients do not receive refresh tokens in response bodies.
- The repair migration can restore a dropped legacy column but cannot recover values already deleted by a previously failed deployment. Production migration history and backups must be checked before deployment.
- New chat messages remain server-readable plaintext until a reviewed per-device key distribution and ratcheting protocol is implemented.

## Deployment decision

This candidate is approved for an annotated `v0.2.49-beta` tag after the final staged snapshot and repeated clean-room audits pass. Deploy the backend before frontend `0.2.70-beta`. Deployment is complete only when `https://api.swebudd.com/health/ready` reports `0.2.49-beta` and the production migration history has been inspected.
