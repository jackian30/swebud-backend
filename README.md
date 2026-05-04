# SweBud Backend

NestJS + Prisma + PostgreSQL backend for SweBud.

## Quick start

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

## Docker

```bash
cp .env.example .env
./deployment/deploy.sh
```

## Main API surface

- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- `GET/PATCH /users/me`
- `GET/PUT /theme`
- `POST/GET /posts`, `GET/DELETE /posts/:id`, likes and comments
- `GET /feed` proximity-aware relevance feed
- `POST/GET /groups`, join and group messages
- `POST /chat/messages`, `GET /chat/conversations/:peerId`
