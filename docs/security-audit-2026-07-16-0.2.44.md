# SweBudd Backend Security Audit — 0.2.44-beta

Date: 2026-07-16

## Resolved findings

- Google sign-in no longer links an existing local account by email; only an already-bound Google subject can sign in to that account.
- Access tokens default to 15 minutes, refresh/login sessions default to 7 days, and access JWT claims no longer contain email.
- Existing HTTP and Socket.IO sessions are rejected immediately when the account is actively banned.
- Public post/profile responses remove precise coordinates, raw activity payloads, hidden Buddy recap fields, and anonymous author identifiers.
- Feed and group like relations are filtered to the current viewer.
- Private groups cannot be joined directly. Private-channel membership is enforced for channel reads and message-ID actions.
- Group list previews and `_count` values are calculated with the viewer's channel access filter, so hidden messages/channels do not affect summaries.
- The server and Prisma schema no longer store chat private keys. New deterministic public-identifier encrypted sends are rejected; legacy rows remain readable for migration compatibility.
- The generated OpenAPI contract contains concrete core client request/response schemas, operation-level bearer/public security metadata, and a production-safe machine-readable endpoint.
- Swagger UI is disabled in production and never persists bearer authorization.

## Automated evidence

The CI gate applies all migrations to a dedicated `swebud_test` database and runs:

```bash
npm run prisma:generate
npm run prisma:deploy
npm test -- --runInBand
npm run test:e2e
npm run lint
npm run build
npm run openapi:check
npm audit --omit=dev --audit-level=high
```

`test/security.e2e-spec.ts` exercises real Nest HTTP guards, Prisma/PostgreSQL queries, and three independent users. It verifies private group/channel boundaries, viewer-filtered previews/counts, anonymous posts, activity/location/recap redaction, private-key rejection, encrypted-send rejection, access-token claims/TTL, and immediate ban invalidation.

The E2E suite refuses to run unless the database name contains `test`.

## Remaining design boundary

New messages are plaintext until a reviewed per-device key distribution and ratcheting protocol is implemented. The product must not advertise the retired deterministic participant-ID scheme as end-to-end encryption.
