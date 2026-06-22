# SweBudd Backend Release Audit - 0.2.40-beta

Date: 2026-06-22
Release candidate: `0.2.40-beta`
Frontend pair: `0.2.57-beta`

## Scope

- Added deterministic local SVG seed media generation under `/uploads/seed-media`.
- Updated normal and realistic seed scripts to use local seed media for avatars, group images, covers, stories, and post images.
- Removed flaky Picsum/Unsplash/pravatar seed dependencies from seeded app media.
- Bumped backend package metadata and README release notes to `0.2.40-beta`.
- Updated local deploy script to use `--remove-orphans`.
- Cleared high-severity dependency audit findings by upgrading `nodemailer` and the `multer` override.

## Verification

- `npm run lint`: passed.
- `npm test`: passed, 23 suites / 161 tests.
- `npm run build`: passed.
- `npx prisma validate`: passed.
- `npx prisma migrate status`: database schema is up to date with 70 migrations.
- `npm audit --audit-level=high`: passed with no high-severity findings.
- `git diff --check`: passed.
- Seed source scan found no `picsum`, `unsplash`, `pravatar`, or `faker.image` use in Prisma seed scripts.
- Compose project check: backend uses project `swebud`, frontend uses `swebud-frontend`, and admin uses `swebud-admin`; backend `--remove-orphans` will not remove frontend/admin containers.

## Dependency Audit Notes

- High-severity findings fixed:
  - `nodemailer` upgraded to `^9.0.1`.
  - `multer` override upgraded to `^2.2.0`.
- Remaining audit output is moderate `js-yaml` through the Jest/ts-jest dev-toolchain path; it is not part of the backend runtime path and would require a breaking forced audit fix.
