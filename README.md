# SweBudd Backend

NestJS + Prisma + PostgreSQL backend for **SweBudd** — a fitness-first social app for posts, salutes, comments, profiles, follows, groups, chat, notifications, hashtags, and local-first beta testing.

Current release: **0.2.23-beta**

## Stack

- NestJS API
- Prisma ORM
- PostgreSQL
- Socket.IO realtime events
- JWT auth with DB-backed sliding sessions
- Docker local deployment
- Render free web service deployment config
- Nodemailer SMTP email delivery with MailHog for local testing

## Main features

- Auth: register, login, Google login scaffold, Cloudflare Turnstile checks, refresh, logout, forgot/reset password
- Sliding sessions: authenticated API activity extends session validity up to 7 days from last activity
- Posts: text/images/video, edit/delete owner-only, save, hide, report, repost, default privacy
- ActSnaps: 24-hour disappearing image/video moments with privacy, views, reactions, replies, and chat reference previews
- Salutes: post/comment salute interactions
- Comments: nested replies, edit/delete owner-only, mentions
- Feed: relevance/latest/trending/unseen, infinite-scroll pagination, hashtag filtering
- Hashtags: search endpoint with post counts for composer suggestions
- Profiles/social graph: username, bio, avatar/cover, follow/unfollow, searchable profile followers/following, mutual/non-followback
- Groups: public/private groups, membership, group posts as regular posts, group feed filtering/pagination
- Chat: message requests, direct/group chat, typing/unread/reactions, validated ActSnap reply references, buddy-session message actions, and multi-device friendly E2EE foundation fields
- Find Buddy: discoverable nearby sessions, buddy rooms, participant rosters, room chat, movement-aware session updates, and realtime map location events
- Notifications: login, salute, comment, reply, mention, follow, message request
- Uploads: MediaLibrary-style collections with local storage by default and S3-ready driver config

## Current beta notes

0.2.23-beta focuses on email delivery reliability and release documentation:

- Forgot-password email dispatch is non-blocking, so reset requests do not hang if the email provider is slow or offline.
- SMTP transport now supports explicit TLS/auth settings, timeout controls, and IPv4/IPv6 family selection.
- Local MailHog remains the default zero-config email target; production can use any SMTP-compatible provider with env config.
- Chat/E2EE documentation has been refreshed for the current direct-chat encryption foundation.

## Tags and discovery

SweBudd supports two post-level tagging systems:

- Hashtags are parsed from post text, normalized to lowercase, stored in `hashtags` + `post_hashtags`, and returned on feed/post responses.
- People tags are explicit selected user ids, stored in `post_tagged_users`, returned as `taggedUsers`, and notify tagged users with a mention notification.

Discovery endpoints:

- `GET /feed/hashtags?q=run` returns matching hashtag suggestions with post counts for the composer.
- `GET /feed/trending-hashtags` returns the top current tags.
- `GET /feed?hashtag=run` filters the main feed by tag.
- `GET /groups/:id/posts?hashtag=run` filters group posts by tag.

The feed relevance ranker also uses the current user's recent preferred hashtags and activity personas as affinity signals.

## Chat documentation

Detailed chat behavior, data flow, realtime events, and the current multi-device friendly end-to-end encryption foundation are documented in:

- [`docs/chats-and-e2ee.md`](docs/chats-and-e2ee.md)

## Local URLs

When using the full local Docker stack:

- Frontend: `http://swebud.loc` or `https://localhost:9443`
- Phone/LAN HTTPS frontend: `https://192.168.18.50:9443`
- Backend through frontend proxy: `http://swebud.loc/api` or `https://localhost:9443/api`
- Backend direct host port: `http://localhost:3002`
- MailHog UI: `http://localhost:8126`

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
- `ALLOW_LOCAL_ORIGINS` — set to `true` only for local/LAN deployments that need `localhost` or private IP browser origins in addition to `FRONTEND_ORIGIN`
- `BACKEND_PORT`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_IGNORE_TLS`, `SMTP_REQUIRE_TLS`, `SMTP_TLS_REJECT_UNAUTHORIZED`, `SMTP_USER`, `SMTP_PASS`, `SMTP_CONNECTION_TIMEOUT_MS`, `SMTP_GREETING_TIMEOUT_MS`, `SMTP_SOCKET_TIMEOUT_MS`, `SMTP_IP_FAMILY`, `MAIL_FROM` — Nodemailer SMTP delivery settings; MailHog local dev uses plaintext, production SMTP should set TLS/auth explicitly
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` / `GOOGLE_OAUTH_REDIRECT_URI` — Google auth placeholders; `POST /auth/google` verifies Google ID tokens and returns onboarding status
- `CLOUDFLARE_TURNSTILE_SITE_KEY` / `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`, `CLOUDFLARE_TURNSTILE_SECRET_KEY` — Turnstile captcha config; backend skips verification in local dev when the secret is empty
- `KLIPY_API_KEY`, `KLIPY_CLIENT_KEY` — GIF search/provider placeholders
- `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL` — legal metadata passed through the local Docker stack
- `MEDIA_STORAGE_DRIVER=local|s3`, `MEDIA_S3_BUCKET`, `MEDIA_PUBLIC_BASE_URL`, `AWS_REGION`, `AWS_S3_ENDPOINT`, `AWS_S3_FORCE_PATH_STYLE` — media storage driver and S3-compatible storage config
- `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN` — reserved for Strava OAuth/webhook integration
- `GARMIN_CONSUMER_KEY`, `GARMIN_CONSUMER_SECRET` — reserved for Garmin OAuth integration
- `MAP_STYLE_URL` — frontend MapLibre/OpenFreeMap style URL used by the Docker stack

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

From the parent SweBudd workspace, the preferred local helper is:

```bash
swebud-up
```

Stop/pause local stack:

```bash
swebud-down
```

Backend code is baked into the Docker image. After backend code or dependency changes, rebuild the image instead of only restarting the container:

```bash
./deployment/deploy.sh
# or
docker compose --env-file deployment/.env -f deployment/docker-compose.yml up -d --build backend
```

Database schema changes still need Prisma migrations (`npm run prisma:migrate` locally, `npm run prisma:deploy` for deploy flows).

The deployment compose file includes a one-shot `migrate` service that runs `npx prisma migrate deploy` before the backend starts. The backend also exposes:

```text
GET /health/live
GET /health/ready
```

`/health/ready` verifies database connectivity and is used by the Docker healthcheck.

## Render + Supabase free web deployment

Use `render.yaml` to create the free backend web service on Render:

```text
Runtime: Node
Region: Singapore
Plan: Free
Build command: npm ci && npm run prisma:generate && npm run build
Start command: npm run start:render
Health check path: /health/live
```

Set these Render environment variables:

```text
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require
DIRECT_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
FRONTEND_ORIGIN=https://<your-cloudflare-pages-domain>
ALLOW_LOCAL_ORIGINS=false
NODE_ENV=production
MEDIA_STORAGE_DRIVER=s3
```

Get the Supabase values step by step:

1. Open Supabase and create/select the SweBud project.
2. Copy the project ref from **Project Settings > General > Reference ID**. Use this as `<project-ref>`.
3. Get the database password from the password saved when the project was created. If it was not saved, go to **Project Settings > Database > Database password** and reset it, then use the new value as `<password>`.
4. Open **Project Settings > Database > Connection string**.
5. Select the **Transaction pooler** connection string for `DATABASE_URL`.
6. Choose the region closest to the deploy target, usually Singapore/ap-southeast-1 for Render Singapore.
7. Copy the URI and replace `[YOUR-PASSWORD]` with the database password. It should match this shape:

```text
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require
```

8. Also copy the direct/session connection string for Prisma migrations and set it as `DIRECT_URL`. It should match this shape:

```text
DIRECT_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
```

Prisma uses `DATABASE_URL` for the running app and `DIRECT_URL` for `prisma migrate deploy`. Do not run migrations through Supabase's transaction pooler.

For **Supabase Storage**, create a public bucket for app media and set:

```text
MEDIA_S3_BUCKET=swebudd-media
MEDIA_PUBLIC_BASE_URL=https://<project-ref>.supabase.co/storage/v1/object/public/swebudd-media/
AWS_REGION=ap-southeast-1
AWS_S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
AWS_S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=<supabase-storage-access-key>
AWS_SECRET_ACCESS_KEY=<supabase-storage-secret-key>
```

Get the Supabase Storage values step by step:

1. Open **Storage > Buckets** in the same Supabase project.
2. Create a bucket for uploads, for example `swebudd-media`.
3. Set the bucket to **Public** so uploaded media can be read by the frontend.
4. Use the bucket name as `MEDIA_S3_BUCKET`.
5. Build the public media base URL with the project ref and bucket name:

```text
MEDIA_PUBLIC_BASE_URL=https://<project-ref>.supabase.co/storage/v1/object/public/swebudd-media/
```

6. Build the S3 endpoint with the same project ref:

```text
AWS_S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
```

7. Open **Project Settings > Storage > S3 Connection**.
8. Create/copy the S3 access key pair.
9. Put the S3 access key ID in `AWS_ACCESS_KEY_ID`.
10. Put the S3 secret access key in `AWS_SECRET_ACCESS_KEY`.
11. Keep `AWS_REGION=ap-southeast-1` and `AWS_S3_FORCE_PATH_STYLE=true`.

For **Cloudflare R2**, set:

```text
MEDIA_S3_BUCKET=<bucket-name>
MEDIA_PUBLIC_BASE_URL=https://media.your-domain.com/
AWS_REGION=auto
AWS_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
AWS_S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=<r2-access-key-id>
AWS_SECRET_ACCESS_KEY=<r2-secret-access-key>
```

Render's free web service has an ephemeral filesystem and sleeps when idle, so production media must use `MEDIA_STORAGE_DRIVER=s3`; do not use local upload storage on Render.

## Production subdomains

Use separate public hosts for the portal and API:

- Portal: `https://swebudd.com`
- API: `https://api.swebudd.com`

Deployment env should use:

```text
FRONTEND_ORIGIN=https://swebudd.com
API_BASE_URL=https://api.swebudd.com
GOOGLE_CALLBACK_URL=https://api.swebudd.com/auth/google/callback
GOOGLE_OAUTH_REDIRECT_URI=https://swebudd.com/auth/google/callback
```

For a Netlify-hosted frontend, set `FRONTEND_ORIGIN` to the Netlify production URL and any preview URLs that should be allowed, separated by commas. Set the frontend's `VITE_API_BASE_URL` to this API origin.

For future iOS/Android clients, keep the same bearer-token API contract and use an absolute HTTPS API origin. Production media should use `MEDIA_STORAGE_DRIVER=s3` plus `MEDIA_PUBLIC_BASE_URL` so native clients receive stable absolute media URLs.

The backend CORS and Socket.IO handshake checks are bearer-token oriented and do not enable browser credential/cookie CORS. Browser and native clients should send `Authorization: Bearer <token>` for HTTP and the Socket.IO `auth.token` value for realtime namespaces.

The frontend container serves the SPA on `FRONTEND_PORT`; the backend container serves the API on `BACKEND_PORT`. Put a host-level reverse proxy in front of both ports. A starting nginx config is available at `deployment/reverse-proxy.nginx.conf.example`.

## Deployment readiness checks

Before shipping a backend change, run:

```bash
npm run build
npm run lint
npm test -- --runInBand
npx prisma validate
```

Production startup validates strong, distinct JWT secrets, required database/frontend origin env, HTTPS-or-local frontend origins, SMTP port shape, and S3 media requirements when `MEDIA_STORAGE_DRIVER=s3`.

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
password
```

If `DATABASE_URL` is not set, `seed:realistic` defaults to the local Docker Postgres URL:

```text
postgresql://swebud:swebud@localhost:55432/swebud?schema=public
```

## Scripts

```bash
npm run dev              # Nest watch mode
npm run start            # run compiled app
npm run start:render     # deploy migrations, then run compiled app on Render
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
- `POST /auth/login` — accepts optional `captchaToken`; required when Turnstile secret is configured
- `POST /auth/google` — accepts Google `idToken`, creates/links an incomplete Google user if needed, returns `requiresOnboarding` + `onboardingMissing`
- `POST /auth/onboarding/complete` — completes username/date-of-birth/legal+data consent and optional multiple activity personas
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `GET /feed`
- `GET /feed/hashtags?q=run`
- `GET /feed/trending-hashtags`
- `GET /actsnaps`
- `POST /actsnaps`
- `POST /actsnaps/:id/view`
- `POST /actsnaps/:id/reply`
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
- `POST /chat/requests`
- `PATCH /chat/requests/:id/accept`
- `PATCH /chat/requests/:id/decline`
- `GET /chat/conversations`
- `GET /chat/conversations/:peerId`
- `PATCH /chat/conversations/:peerId/read`
- `GET /chat/keys/:peerId`
- `POST /chat/keys`
- `POST /chat/messages`
- `POST /chat/messages/:id/reactions`
- `DELETE /chat/messages/:id/reactions`
- `DELETE /chat/messages/:id`
- `GET /chat/buddy-groups`
- `POST /chat/buddy-groups`
- `GET /chat/buddy-groups/:id`
- `POST /chat/buddy-groups/:id/participants`
- `GET /chat/buddy-groups/:id/messages`
- `POST /chat/buddy-groups/:id/messages`
- `GET /buddy/activities`
- `PUT /buddy/session`
- `DELETE /buddy/session`
- `GET /buddy/nearby`
- `GET /buddy/discoverable`
- `GET /buddy/rooms`
- `POST /buddy/rooms`
- `POST /buddy/rooms/join`
- `GET /buddy/rooms/:id/messages`
- `POST /buddy/rooms/:id/messages`
- `POST /buddy/rooms/:id/messages/:messageId/reactions`
- `DELETE /buddy/rooms/:id/messages/:messageId/reactions`
- `DELETE /buddy/rooms/:id/messages/:messageId`
- `POST /buddy/rooms/:id/messages/read`
- `GET /chat/unread-count`
- `GET /notifications`
- `POST /uploads/profile-photo`
- `POST /uploads/cover-photo`
- `POST /uploads/actsnap-media`
- `POST /uploads/post-media`
- `POST /uploads/comment-media`

## Release gate

Before pushing a beta release, run:

```bash
npm run build
npm test -- --runInBand
npm run lint
npm audit
npx prisma validate
npx prisma migrate status
```

Then run the full Docker stack and API smokes from the workspace if available.

## Security notes

- Protected controllers use `JwtAuthGuard`.
- Helmet, CORS, and global validation pipe are enabled in `src/main.ts`.
- JWTs include a session id (`sid`) checked against `RefreshToken` rows.
- Session expiry is sliding: authenticated API calls extend expiry to 7 days from that activity.
- Refresh token rotation revokes the old stored token.
- Public profile and post responses strip private account fields and exact user coordinates.
- ActSnap reference context is only accepted from trusted ActSnap reply flows; generic chat sends ignore client-supplied ActSnap reference fields.
- Google-created users do not bypass onboarding: auth responses include `requiresOnboarding` and `onboardingMissing` until username, date of birth, legal consent, and data consent are completed.
- Turnstile is enforced on register/login when `CLOUDFLARE_TURNSTILE_SECRET_KEY` is set; with no secret it returns a local-dev skip and does not block.
- While the backend `package.json` version contains `beta`, newly-created password and Google accounts are marked `betaUser` and assigned the `beta_user` profile badge automatically.
- E2EE chat support is currently a foundation only. Direct buddy chats work across logged-in devices, but this is not a production-audited Signal-grade implementation.

## Release tags

Create the release tag only after committing the matching version bump and release changes:

```bash
git tag -a v0.2.23-beta -m "v0.2.23-beta"
git push origin v0.2.23-beta
```

## Beta caveats

- Local uploads are dev-oriented; S3-compatible storage is supported through the media storage driver env config.
- Email delivery is configured for MailHog locally. Production email uses SMTP env settings through Nodemailer.
- Relevance ranking is MVP-level and should be tuned with real usage data.
- Backend unit/API coverage is in place for current 0.2.23-beta flows, but production release still needs broader end-to-end coverage.
