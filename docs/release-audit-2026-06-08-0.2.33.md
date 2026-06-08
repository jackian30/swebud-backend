# SweBudd Backend Release Audit - 0.2.33-beta

Date: 2026-06-08
Release candidate: `0.2.33-beta`
Frontend pair: `0.2.46-beta`

## Scope

- Fixed buddy `stopPresence` so room-based buddy sessions are expired instead of ignored.
- Marked buddy room participants as left when their active room session is expired.
- Emitted room presence stopped events after room-session expiration so active clients can auto-clear stale users.
- Re-ran room close checks after a room participant leaves, including the no-active-manager case.
- Updated backend package metadata to `0.2.33-beta`.

## API Contract Audit

- `stopPresence(userId)` still returns `{ ok: true }` for missing sessions and successful stop requests.
- Direct buddy session expiration behavior is unchanged.
- Room buddy session expiration now deletes the active session, updates participant `leftAt`/`lastActivityAt`, emits room presence stopped, and then evaluates room close conditions.
- Frontend room/buddy map cleanup in `0.2.46-beta` consumes the resulting room presence stopped behavior.

## Verification

- Backend `npm run prisma:generate`: passed.
- Backend `npx prisma validate`: passed.
- Backend `npm run lint`: passed.
- Backend `npm run build`: passed.
- Backend `npm test -- --runInBand`: 22 suites passed, 155 tests passed.
- Backend `npm audit --audit-level=high`: passed with 0 vulnerabilities.

## Residual Risks

- No live backend Docker redeploy was performed during this release audit.
- Room close behavior still depends on the existing owner/admin activity rules after the stop event is processed.
