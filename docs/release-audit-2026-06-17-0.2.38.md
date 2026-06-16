# SweBudd Backend Release Audit - 0.2.38-beta

Date: 2026-06-17
Release candidate: `0.2.38-beta`
Frontend pair: `0.2.52-beta`

## Scope

- Added Buddy Session room update support through `PATCH /buddy/rooms/:id` for owner/admin activity changes.
- Added room pinned-location persistence and migration support.
- Emits live room updates for `buddy:room-updated` and `buddy:room-pinned-location` changes.
- Keeps pinned destination updates scoped to the active room and guarded by existing membership/admin checks.
- Bumped backend release metadata to `0.2.38-beta`.

## Verification

- `npm run lint`: passed.
- `npm test`: passed, 23 suites / 161 tests.
- `npm run build`: passed.
- `npx prisma validate`: passed.
- `npm audit --audit-level=high`: passed after non-forced audit fixes.
- `git diff --check`: passed.

## Dependency Audit Notes

- High-severity backend audit findings are cleared.
- Moderate dev-toolchain advisories remain through the Jest/ts-jest `js-yaml` dependency path. npm reports that the remaining fix requires a breaking forced upgrade, so it was not applied in this release.
