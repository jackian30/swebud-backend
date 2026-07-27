# Email verification and account-age policy

## API contract

- `GET /auth/policy` is public and returns `{ "minimumAccountAge": 18 }` using the current server configuration.
- `POST /auth/verify-email` is public and accepts `{ "token": "<selector>.<secret>" }`. A valid first use returns `{ "ok": true, "emailVerified": true }`. Invalid, expired, and already-used tokens all return the same `400` error.
- `POST /auth/resend-verification` is public and accepts an optional `{ "email": "person@example.com" }`. Missing, unknown, already-verified, and cooldown-limited requests all return the same `200` response: `{ "ok": true, "message": "If the account exists and still needs verification, a verification email will be sent." }`.

Raw verification tokens are only placed in SMTP-delivered frontend URLs. They are never returned by an API response or written to application logs.

## Token and resend controls

Verification tokens contain a random 128-bit selector and a random 256-bit secret. PostgreSQL stores the selector and the SHA-256 digest of the secret, never the bearer token. Tokens expire after `EMAIL_VERIFICATION_TTL_SECONDS`, are atomically claimed once, and all sibling tokens are invalidated when one succeeds or a replacement is issued.

`email_verification_sent_at` on the user row provides an atomic per-account resend claim. It prevents concurrent API processes from bypassing `EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS`. The existing per-IP auth rate limiter provides a second layer. Every resend response also waits for a common 250 ms minimum plus 0–50 ms of cryptographic jitter, so the unknown-account path does not expose its shorter database workflow as a practical timing oracle.

Changing a password account's email locks the user row, clears its email verification, disconnects the old Google subject binding, and invalidates every unused email-verification and password-reset token in one transaction. Only after that transaction commits does the service issue a token for the new address. A token-issuance or mail failure therefore cannot revive an old-mailbox credential or roll back the unverified state; the user can safely retry through the resend endpoint. Verification and password-reset consumption use the same user-row-first lock order so a concurrent old-token claim cannot cross an email change.

An authenticated password change uses the same account-row serialization rule. The password update, invalidation of every unused password-reset token, and revocation of all active refresh tokens and login sessions commit together.

Forgot-password responses are identical for known and unknown addresses and take at least 300 ms plus 0–50 ms of cryptographic jitter. For a known account, issuance locks the user row, rechecks the normalized address, invalidates every unused reset token, and creates exactly one replacement in the same transaction. Reset consumption locks that same user row before claiming the presented token; the password update, sibling-token invalidation, and revocation of every active refresh token and login session then commit atomically.

## Feature gates

An unverified account may authenticate, refresh/logout, finish onboarding, use account recovery and session-revocation controls, inspect read-only surfaces, change its email, request verification, block/unblock another user, submit a safety report, or delete the account. Blocks and reports are deliberately exempt so verification cannot remove immediate safety controls.

All other state-changing feature endpoints are fail-closed at controller scope. This includes:

- posts, comments, reactions, saves, pins, hides, stories, follows, close buddies, and search history;
- direct, buddy-group, standard-group, and buddy-room messaging, reactions, requests, read state, mute/pin state, and message deletion;
- group, buddy-session, buddy-room, activity, integration, notification, and theme mutations;
- media uploads and sensitive profile updates;
- every client-originated realtime social event, currently `chat:send`, `chat:typing`, and `buddy:room-typing`.

HTTP reads remain available to onboarded unverified accounts. A reflection-based route-matrix test fails CI when a new mutation lacks either the reusable verification guard, dedicated admin authentication, or an explicit route-specific exemption with a rationale.

## Age enforcement

SweBudd is currently adults-only. `MINIMUM_ACCOUNT_AGE` defaults to 18 and production startup rejects any value below 18 because no guardian-consent or minor-account workflow exists. Development and tests may exercise values from 13 upward, but that does not relax the production floor.

The configured age is enforced from UTC calendar dates during password registration, Google onboarding, both onboarding endpoints, login, refresh, access-token session validation, and realtime socket authentication. A date of birth cannot be changed or removed after it is set. Clients should read `GET /auth/policy` rather than hard-code the age.

## Existing-account rollout

Migration `20260727110000_add_email_verification` backfills `email_verified_at` only for accounts whose email was already verified by Google. Existing password accounts are deliberately not grandfathered because the service has no evidence that they control their stored address. Those accounts can still log in and request a verification email, but the gated writes above remain locked until verification succeeds.

For an already-linked Google subject, Google only proves the stored account email when the normalized token email exactly matches it. The existing account's ban and age policy are checked before any display name, picture, or email-verification flag can be updated. A changed provider email never verifies a different stored address; the stored address remains unchanged and retains its prior verification state. If the changed provider email belongs to another local account, Google sign-in is rejected rather than merging or reassigning either account.
