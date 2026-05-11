# Backend Assessment - 2026-05-11

## Summary

The main normalization issue addressed in this pass was user activity personas. The previous schema stored the same preference in two forms on `users`:

- `activity_persona`
- `activity_personas[]`

That created duplicated state and used a PostgreSQL array for repeatable user preferences. The schema now stores activity personas in `user_activity_personas`, one row per user/persona, with `sort_order` preserving the preferred order. Backend APIs still return `activityPersona` and `activityPersonas` so the frontend contract stays stable.

## Changed

- Added `user_activity_personas`.
- Migrated existing `users.activity_persona` and `users.activity_personas[]` data into the new table.
- Dropped the old user activity persona columns.
- Updated auth, users, feed ranking, buddy sessions, and seeders to use the normalized relation.
- Kept response compatibility by mapping relation rows back to:
  - `activityPersona`: first selected persona, or `null`
  - `activityPersonas`: ordered persona array

## Assessment Notes

- Social join tables are already normalized: follows, blocks, close buddies, saves, views, likes, reports, roles, and group memberships use composite keys or unique constraints appropriately.
- Media is mostly normalized into `post_images` and `comment_images`.
- `likeCount`, `commentCount`, `viewCount`, and repost counts are intentionally denormalized counters for feed performance. Keep them, but treat them as derived values and update them transactionally.
- Message and message request reference preview fields are duplicated by design for immutable previews. They could be normalized later if shared reference editing becomes a requirement.
- Location fields on users/posts/buddy sessions are not a normalization issue by themselves, but they should remain carefully excluded from public projections where not needed.

## Follow-Up Candidates

- Add database check constraints for invalid self-relations, such as self-follows, self-blocks, and self close-buddy rows.
- Consider a shared media asset table if uploads need reuse, ownership, moderation, or cleanup tracking across posts, comments, stories, profiles, and groups.
- Consider replacing free-form activity `type` strings with a typed lookup table only if imported fitness integrations need cross-provider canonicalization.
