# SweBudd Backend Release Audit - 0.2.41-beta

Date: 2026-06-29
Release candidate: `0.2.41-beta`
Frontend pair: `0.2.60-beta`

## Scope

- Added Buddy Room personal pins scoped to the current user.
- Kept shared room pin updates explicit and limited to owners, moderators, and admins.
- Stored personal pins separately from shared room pins.
- Updated Buddy Room APIs and DTOs so frontend clients can render personal, shared, self/live, and other-user pins independently.
- Added service coverage for personal pin defaults, authorization, and pin isolation.
- Corrected release metadata from the retry-style `0.2.40-beta-r1` label to the next backend release `0.2.41-beta`.

## Verification

- `npm run lint`: passed.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm test`: passed, 23 suites / 163 tests.
- `npm run build`: passed.
- `git diff --check`: passed.
