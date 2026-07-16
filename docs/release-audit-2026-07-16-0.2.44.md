# SweBudd Backend Release Audit - 0.2.44-beta

Date: 2026-07-16
Release candidate: `0.2.44-beta`
Frontend pair: `0.2.69-beta`

## Scope

- Hardened browser and native authentication around short-lived access tokens, rotating refresh sessions, exact-origin checks, host-only `HttpOnly` browser cookies, and explicit native transport controls.
- Prevented Google sign-in from implicitly linking an existing local account by email and invalidated already-issued HTTP and Socket.IO sessions when an account is actively banned.
- Removed sensitive fields from public post/profile presentation, including precise coordinates, raw provider activity payloads, hidden Buddy recap fields, and anonymous author identifiers.
- Enforced private-group invitations, private-channel membership, viewer-filtered previews/counts, message-action authorization, typing authorization, blocked-sender filtering, and hidden-message unread behavior.
- Made multi-write group-invite, role-management, blocking, and related social-graph operations atomic.
- Rejected blank group-chat inputs and empty text-only comment edits, corrected latest-story ordering, and bounded pagination across posts, feeds, groups, and activities.
- Added timeouts to external requests and made production Turnstile verification fail closed on upstream errors.
- Removed chat private-key storage and rejected new deterministic participant-identifier encrypted sends while retaining legacy-row read compatibility.
- Reconciled the Prisma schema and migration history, including removal of the stale repost unique index and legacy enum.
- Added explicit UUID parsing for all UUID-backed HTTP route parameters and concrete validation DTOs for realtime typing payloads. Intentional slug, provider-enum, and UUID-or-username routes remain explicitly typed exceptions.
- Made the generated OpenAPI artifact the versioned client contract and added CI checks for migrations, drift, PostgreSQL E2E behavior, OpenAPI freshness, and production dependencies.
- Removed embedded production storage identifiers and unsafe localhost mail defaults from cloud configuration, and aligned deployment preflight checks with runtime SMTP, TLS, secret, and origin requirements.
- Corrected deployment-audit negative assertions that previously ran as ineffective standalone negations; ShellCheck now validates the deployment scripts.

## Clean-room verification

Two complete clean-room audit passes were run against the finalized candidate. Both passes completed without a failing release gate.

- `npm ci`: passed; 869 packages installed and 870 packages audited, with 0 vulnerabilities.
- `npm run prisma:generate`: passed.
- `npx prisma validate`: passed.
- Fresh PostgreSQL 16 main and shadow databases: all 74 migrations applied successfully from empty databases.
- `npx prisma migrate status`: passed; migration history is current.
- Live database to Prisma schema drift check: passed with no differences.
- Migration history to Prisma schema drift check: passed with no differences.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm test -- --runInBand --detectOpenHandles`: passed, 43 suites / 437 tests.
- `npm run test:e2e`: passed, 1 suite / 7 PostgreSQL E2E tests.
- `npm run openapi:check`: passed; the committed artifact is current.
- OpenAPI/runtime boundary checks: passed; all 107 UUID-backed route parameters are parsed as UUIDs, repeated UUID path parameters declare `format: uuid`, and the intentional user identifier routes remain UUID-or-username strings.
- `npm audit --audit-level=low`: passed with 0 vulnerabilities.
- `npm audit --omit=dev --audit-level=low`: passed with 0 vulnerabilities.
- `./deployment/audit.sh`: passed, including production/development Compose validation and deployment preflight assertions.
- ShellCheck 0.11.0: passed for all deployment shell scripts after the ineffective negative-assertion pattern was corrected.
- Bash syntax, Node syntax, conflict-marker, zero-byte-file, JSON parsing, and `git diff --check` checks: passed.
- Strict Gitleaks 8.30.1 scans of tracked and untracked candidate files: passed with 0 findings. The two intentionally empty Garmin example variables were normalized so their adjacency no longer produced a false positive; no credentials were added.
- Supplemental private-key, provider-token, AWS, GitHub, Google, npm, OpenAI, Supabase, and JWT secret scans: passed with 0 findings.

## Contract and migration evidence

- The backend and paired frontend OpenAPI artifacts are byte-identical.
- The generated contract covers 178 frontend adapter operations and declares operation-level public/bearer security metadata.
- Real E2E tests use an isolated database whose name must contain `test`; the suite refuses unsafe database targets.
- The clean database contained 74 successful migration records after deployment, and both independent drift directions returned no differences.
- CI now deploys migrations, verifies live-schema drift, runs the real PostgreSQL E2E suite, checks OpenAPI freshness, and audits production dependencies.

## Release and deployment status

No production deployment was performed as part of this audit. Release tagging and publication are permitted only after the finalized candidate is committed, the staged snapshot passes the same integrity and secret checks, and the matching annotated tag is created from that commit.

## Remaining design boundary

New chat messages are stored as server-readable plaintext until a reviewed per-device key distribution and ratcheting protocol is implemented. Legacy encrypted rows remain readable for migration compatibility, but the retired deterministic participant-identifier scheme must not be described as end-to-end encryption.
