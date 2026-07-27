# Backend-owned admin moderation API

The backend exposes an admin-only moderation contract at `/admin/moderation/v1`. It is intentionally separate from the consumer JWT surface and is the authoritative write path for moderation state, lifecycle records, audit events, and downstream outbox events.

## Authentication contract

Every request requires `Authorization: Bearer <admin-jwt>`. Admin JWTs use HS256 and the dedicated `ADMIN_JWT_SECRET`; consumer access or refresh secrets are never accepted.

Required claims:

- `sub`: immutable namespaced admin identity in the exact canonical positive-bigint form `admin:<id>`, for example `admin:1`. The suffix is 1-122 decimal digits, starts with `1-9`, and therefore permits neither zero nor leading zero.
- `iss`: exactly `ADMIN_JWT_ISSUER`.
- `aud`: exactly the string `ADMIN_JWT_AUDIENCE`; an audience array is rejected.
- `iat` and `exp`: integer NumericDate values. The token must be currently valid, `exp` must follow `iat`, and the lifetime cannot exceed 300 seconds.
- `jti`: unique 16-128 character identifier. It is consumed once across all instances through the database replay table.
- `amr`: string array containing `mfa`.
- `scope`: space-delimited granular scopes.

Mint a fresh token and `jti` for every HTTP request. An idempotent retry reuses the same `Idempotency-Key` but uses a new admin JWT and `jti`. Expired replay rows are removed in bounded pages during normal traffic.

Production must set a strong, independent `ADMIN_JWT_SECRET`, `ADMIN_JWT_ISSUER`, and `ADMIN_JWT_AUDIENCE`. The local defaults are development-only.

## Mutation headers and transaction boundary

Every state-changing route also requires:

- `X-Request-ID`: a UUID v4, unique across moderation mutations.
- `Idempotency-Key`: 8-128 safe ASCII characters, unique per admin actor and logical operation for at least 24 hours.

The idempotency claim, domain write, immutable audit event, outbox event, and cached response are committed in one database transaction. A retry with the same actor, key, request ID, operation, and canonical request body returns the cached response. Retries must keep the original `X-Request-ID`; changing it while reusing the idempotency key, reusing a key for different input, or reusing a request ID for another operation returns `409 Conflict`.

The service only classifies Prisma `P2002` errors as idempotency collisions when the violated target is the actor/key or request-ID constraint. Other uniqueness failures remain real domain/database errors.

## Scopes and routes

`type` is one of `post`, `user`, `group`, or `message`.

| Scope | Routes |
| --- | --- |
| `moderation:reports:read` | `GET /reports` |
| `moderation:reports:resolve` | `PATCH /reports/:type/:id` |
| `moderation:reports:assign` | `PATCH /reports/:type/:id/assignment` |
| `moderation:reports:notes:read` | `GET /reports/:type/:id/notes` |
| `moderation:reports:notes` | `POST /reports/:type/:id/notes` |
| `moderation:reports:escalate` | `POST /reports/:type/:id/escalations` |
| `moderation:appeals:read` | `GET /reports/:type/:id/appeals` |
| `moderation:appeals:write` | `POST /reports/:type/:id/appeals`, `PATCH /appeals/:id` |
| `moderation:evidence:read` | `GET /reports/:type/:id/evidence` |
| `moderation:evidence:write` | `POST /reports/:type/:id/evidence` |
| `moderation:evidence:retention` | `PATCH /evidence/:id/retention` |
| `moderation:users:ban` | `POST /users/:id/ban`, `POST /users/:id/unban` |
| `moderation:users:sessions:revoke` | `POST /users/:id/revoke-sessions` |
| `moderation:content:write` | post/group/message quarantine and restore routes |

All paths above are relative to `/admin/moderation/v1`.

The canonical OpenAPI publishes the exact singular scope for every operation in
the deterministic `x-required-scope` extension. Admin clients should validate
that extension together with `adminBearer` security and the required mutation
headers; backend generation fails closed if route metadata and this contract
inventory diverge.

## Queue response and facets

`GET /reports` accepts `type`, `status`, `category`, `assignedReviewerId`, `escalated`, `overdue`, `take`, and `cursor`. It merges all four report tables and returns:

```json
{
  "items": [],
  "nextCursor": null,
  "summary": {
    "open": 0,
    "reviewing": 0,
    "resolved": 0,
    "dismissed": 0,
    "total": 0,
    "overdue": 0,
    "byCategory": {
      "spam": 0,
      "harassment": 0,
      "hate": 0,
      "sexual_content": 0,
      "violence": 0,
      "self_harm": 0,
      "scam": 0,
      "privacy": 0,
      "impersonation": 0,
      "illegal_activity": 0,
      "other": 0
    }
  }
}
```

The status facet ignores the requested `status` while retaining every other filter. `byCategory` ignores the requested `category` while retaining every other filter. `summary.overdue` forces `overdue=true` while retaining type, status, category, reviewer, and escalation filters, so clients can display the matching overdue workload even when the current page asks for `overdue=false`. `summary.total` is the sum of the four status counts, not the current page length. Aggregations use bounded enum `groupBy` and count queries across only the selected report types.

`overdue=true` means an `open` or `reviewing` report whose `slaDueAt` is strictly in the past. `overdue=false` is its exact complement: it includes reports with no SLA, a current/future SLA, or a terminal status. When combined with `status`, both predicates apply; conflicting filters correctly produce an empty result instead of overriding one another.

Each queue item includes assignment, SLA, priority/escalation, resolution fields, an internal-note count, appeal summaries, and evidence-retention summaries.

## Lifecycle behavior

- Assignments record the reviewer and assignment timestamp. An SLA due timestamp can be set or cleared.
- Escalation records level, reason, actor, timestamp, optional priority, and optional SLA change.
- Internal notes are admin-only and immutable at the database layer.
- Terminal report statuses (`resolved` or `dismissed`) require a resolution note.
- Evidence records include a storage key, SHA-256 digest, media type, byte size, JSON metadata, retention expiry, and legal-hold flag. Retention changes are audited; a stored legal hold prevents shortening the active deadline, including while trying to clear the hold in the same request. Release the hold in one audited mutation before a later shortening.
- Appeals are created through this admin/support API for the affected user, including when that user is banned. This is not a direct consumer self-service appeal endpoint. Reviews support assignment and an explicit disposition; terminal appeal decisions require a resolution note.

## Enforcement effects

Banning a user revokes all active refresh tokens and login sessions in the same transaction. Unbanning does not restore revoked sessions.

The standalone session-revocation route invalidates every unrevoked refresh token and login session without changing the user's moderation status. Its optional `note` is retained in the immutable audit event, while the response and outbox payload report `userId`, `revokedRefreshTokens`, and `revokedLoginSessions`.

Quarantined posts, groups, and messages are excluded from consumer reads. Their user/owner mutation paths are frozen until an authorized admin restores them. Quarantining a group also hides its posts and chat surfaces through the active-group visibility checks. Message quarantine applies to direct, buddy-group, and group-channel messages: history, search, latest-message summaries, unread counts, reply targets, reactions, pins, read updates, delete-for-me, and unsend paths all treat quarantined rows as unavailable. Existing participants may still submit or update a safety report for a known message ID so quarantine cannot suppress abuse intake.

Database check constraints keep every post, group, and message moderation row internally consistent: active content has no quarantine metadata, while quarantined content must record its timestamp, admin actor, and non-empty API-supplied reason.

Audit and internal-note tables have database triggers that reject update and delete attempts. Outbox consumers should use `requestId` for traceability and process events idempotently.

The generated OpenAPI artifact at `openapi/v1/openapi.json` is the machine-readable source for request and response schemas.
