# SweBudd NestJS backend.
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache su-exec

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node prisma ./prisma
RUN npx prisma generate
COPY --chown=node:node --from=build /app/dist ./dist
RUN mkdir -p uploads && chown -R node:node uploads

EXPOSE 3000
CMD ["sh", "-c", "mkdir -p uploads/images uploads/videos && chown -R node:node uploads && exec su-exec node node dist/src/main.js"]
