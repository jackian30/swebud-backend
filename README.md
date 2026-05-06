# SweBud Backend

NestJS + Prisma + PostgreSQL backend for **SweBud** — a fitness-first social app for posts, salutes, comments, profiles, follows, groups, chat, notifications, hashtags, and local-first beta testing.

Current release: **0.1.3 beta**

## Stack

- NestJS API
- Prisma ORM
- PostgreSQL
- Socket.IO realtime events
- JWT auth with DB-backed sliding sessions
- Docker local deployment
- MailHog for local email testing

## Main features

- Auth: register, login, Google login scaffold, Cloudflare Turnstile checks, refresh, logout, forgot/reset password
- Sliding sessions: authenticated API activity extends session validity up to 7 days from last activity
- Posts: text/images, edit/delete owner-only, save, hide, report, repost
- Salutes: post/comment salute interactions
- Comments: nested replies, edit/delete owner-only, mentions
- Feed: relevance/latest/trending/unseen, infinite-scroll pagination, hashtag filtering
- Hashtags: search endpoint with post counts for composer suggestions
- Profiles/social graph: username, bio, avatar/cover, follow/unfollow, searchable profile followers/following, mutual/non-followback
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
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` / `GOOGLE_OAUTH_REDIRECT_URI` — Google auth placeholders; `POST /auth/google` verifies Google ID tokens and returns onboarding status
- `CLOUDFLARE_TURNSTILE_SITE_KEY` / `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`, `CLOUDFLARE_TURNSTILE_SECRET_KEY` — Turnstile captcha config; backend skips verification in local dev when the secret is empty
- `KLIPY_API_KEY`, `KLIPY_CLIENT_KEY` — GIF search/provider placeholders
- `APP_VERSION`, `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL` — release/legal metadata passed through the local Docker stack
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

From the parent SweBud workspace, the preferred local helper is:

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

## Production subdomains

Use separate public hosts for the portal and API:

- Portal: `https://asdasd.com`
- API: `https://api.asdasd.com`

Deployment env should use:

```text
FRONTEND_ORIGIN=https://asdasd.com
API_BASE_URL=https://api.asdasd.com
GOOGLE_CALLBACK_URL=https://api.asdasd.com/auth/google/callback
GOOGLE_OAUTH_REDIRECT_URI=https://asdasd.com/auth/google/callback
```

The frontend container serves the SPA on `FRONTEND_PORT`; the backend container serves the API on `BACKEND_PORT`. Put a host-level reverse proxy in front of both ports. A starting nginx config is available at `deployment/reverse-proxy.nginx.conf.example`.

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
- Google-created users do not bypass onboarding: auth responses include `requiresOnboarding` and `onboardingMissing` until username, date of birth, legal consent, and data consent are completed.
- Turnstile is enforced on register/login when `CLOUDFLARE_TURNSTILE_SECRET_KEY` is set; with no secret it returns a local-dev skip and does not block.
- E2EE chat support is currently a foundation only, not a production-audited Signal-grade implementation.

## Beta caveats

- Local uploads are dev-oriented.
- Email delivery is configured for MailHog locally.
- Relevance ranking is MVP-level and should be tuned with real usage data.
- More automated backend tests are needed before production release.
