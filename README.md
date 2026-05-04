# SweBud Backend

NestJS + Prisma + PostgreSQL backend for **SweBud** — a fitness-first social app for posts, salutes, comments, profiles, follows, groups, chat, notifications, hashtags, and local-first beta testing.

Current release: **0.1.1 beta**

## Stack

- NestJS API
- Prisma ORM
- PostgreSQL
- Socket.IO realtime events
- JWT auth with DB-backed sliding sessions
- Docker local deployment
- MailHog for local email testing

## Main features

- Auth: register, login, refresh, logout, forgot/reset password
- Sliding sessions: authenticated API activity extends session validity up to 7 days from last activity
- Posts: text/images, edit/delete owner-only, save, hide, report, repost
- Salutes: post/comment salute interactions
- Comments: nested replies, edit/delete owner-only, mentions
- Feed: relevance/latest/trending/unseen, infinite-scroll pagination, hashtag filtering
- Hashtags: search endpoint with post counts for composer suggestions
- Profiles/social graph: username, bio, avatar/cover, follow/unfollow, followers/following/mutual/non-followback
- Groups: public/private groups, membership, group posts as regular posts, group feed filtering/pagination
- Chat: message requests, direct/group chat, typing/unread/reactions, E2EE foundation fields
- Notifications: login, salute, comment, reply, mention, follow, message request
- Uploads: local upload endpoint for dev

## Local URLs

When using the full local Docker stack:

- Frontend: `http://swebud.loc`
- Backend through frontend proxy: `http://swebud.loc/api`
- Backend direct host port: `http://localhost:3002`
- MailHog UI: `http://localhost:8026`

Make sure `/etc/hosts` contains:

```text
127.0.0.1 swebud.loc
```

## Environment

Copy the example env file:

```bash
cp .env.example .env
```

For the Docker deployment folder:

```bash
cp deployment/.env.example deployment/.env
```

Important variables:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `FRONTEND_ORIGIN`
- `BACKEND_PORT`
- `SMTP_HOST`
- `SMTP_PORT`

Do not commit real `.env` files.

## Install

```bash
npm install
npm run prisma:generate
```

## Development

Run the API directly:

```bash
npm run dev
```

Run Prisma migration locally:

```bash
npm run prisma:migrate
```

Generate Prisma client:

```bash
npm run prisma:generate
```

## Docker/local deployment

From this repo:

```bash
./deployment/deploy.sh
```

From the parent SweBud workspace, the preferred local helper is:

```bash
swebud-up
```

Stop/pause local stack:

```bash
swebud-down
```

## Seed data

Basic Faker seed:

```bash
npm run seed
```

Realistic randomized beta sample data:

```bash
npm run seed:realistic
```

The realistic seed creates varied users, profiles, follows, groups, posts, comments, salutes, reposts, messages, hashtags, long-post edge cases, and image-heavy posts.

Default sample login:

```text
real.user.1@swebud.loc
password123
```

If `DATABASE_URL` is not set, `seed:realistic` defaults to the local Docker Postgres URL:

```text
postgresql://swebud:swebud@localhost:5432/swebud?schema=public
```

## Scripts

```bash
npm run dev              # Nest watch mode
npm run start            # run compiled app
npm run build            # compile backend
npm test                 # Jest test gate; passes with no tests currently
npm run lint             # ESLint
npm run prisma:generate  # generate Prisma client
npm run prisma:migrate   # local Prisma migration workflow
npm run prisma:deploy    # deploy migrations
npm run seed             # standard seed
npm run seed:realistic   # realistic beta sample data
```

## API surface

Base path when proxied locally: `/api`

Key endpoints:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `GET /feed`
- `GET /feed/hashtags?q=run`
- `GET /feed/trending-hashtags`
- `GET /posts/:id`
- `POST /posts`
- `PATCH /posts/:id`
- `DELETE /posts/:id`
- `POST /posts/:id/like`
- `DELETE /posts/:id/like`
- `GET /posts/:id/comments`
- `POST /posts/:id/comments`
- `GET /users/me`
- `PATCH /users/me`
- `GET /users/:id`
- `GET /groups`
- `POST /groups`
- `GET /groups/:slug`
- `GET /groups/:id/posts`
- `POST /groups/:id/posts`
- `GET /chat/requests`
- `POST /chat/messages`
- `GET /notifications`

## Release gate

Before pushing a beta release, run:

```bash
npm run build
npm test -- --runInBand
npm run lint
```

Then run the full Docker stack and API smokes from the workspace if available.

## Security notes

- Protected controllers use `JwtAuthGuard`.
- Helmet, CORS, and global validation pipe are enabled in `src/main.ts`.
- JWTs include a session id (`sid`) checked against `RefreshToken` rows.
- Session expiry is sliding: authenticated API calls extend expiry to 7 days from that activity.
- Refresh token rotation revokes the old stored token.
- E2EE chat support is currently a foundation only, not a production-audited Signal-grade implementation.

## Beta caveats

- Local uploads are dev-oriented.
- Email delivery is configured for MailHog locally.
- Relevance ranking is MVP-level and should be tuned with real usage data.
- More automated backend tests are needed before production release.
