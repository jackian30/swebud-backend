# SweBudd Backend Release Audit - 0.2.32-beta

Date: 2026-06-08
Release candidate: `0.2.32-beta`
Frontend pair: `0.2.45-beta`

## Scope

- Added pending approval-based `GroupInvite` records and migration `20260608180500_add_group_invites`.
- Added group invite APIs for listing, accepting, declining, invite candidates, member-sent invites, and create-group invites.
- Added `group_invite` notification type and group invite notifications.
- Normalized group create slugs in the DTO so mobile keyboard capitalization and spaces are cleaned before validation.
- Updated backend package metadata to `0.2.32-beta`.

## API Contract Audit

- `CreateGroupDto.inviteUserIds` matches frontend create-group payload and allows up to 50 UUIDs.
- `InviteGroupUsersDto.userIds` matches frontend group-page invite payload and allows up to 50 UUIDs.
- `GET /groups/invites` returns pending invites with inviter and group summary data used by `/groups/invites`.
- `POST /groups/invites/:inviteId/accept` joins the recipient, marks the invite accepted, marks the invite notification read, and returns the joined group detail.
- `POST /groups/invites/:inviteId/decline` marks the invite declined, marks the invite notification read, and returns `{ ok: true }`.
- `GET /groups/:id/invite-candidates` and `POST /groups/:id/invites` require existing group membership, so every member can send invites while non-members cannot.

## Verification

- Backend `npm run prisma:generate`: passed.
- Backend `npx prisma validate`: passed.
- Backend `npx prisma migrate status`: database schema is up to date.
- Backend `npm run lint`: passed.
- Backend `npm run build`: passed.
- Backend `npm test -- --runInBand`: 22 suites passed, 155 tests passed.
- Backend Docker redeploy on `localhost:3002`: health returned `0.2.32-beta`.
- Runtime API smoke passed: create with invite, accept, member-sent invite, decline, candidate filtering, and smoke cleanup.

## Residual Risks

- Group invite notifications are fire-and-forget, matching existing notification patterns; the invite record is still created if notification delivery fails.
- Existing public invite-code join remains available alongside the new approval-based member invites.
