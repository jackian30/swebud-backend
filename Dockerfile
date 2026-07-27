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
ENV NODE_ENV=production \
    MEDIA_PROCESSING_TEMP_DIR=/app/media-processing-tmp

RUN apk add --no-cache ffmpeg

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node prisma ./prisma
RUN npx prisma generate
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node --from=build /app/dist ./dist
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p uploads/images uploads/videos uploads/audio /app/media-processing-tmp \
    && chown -R node:node uploads /app/media-processing-tmp
USER node

EXPOSE 3000
ENTRYPOINT ["node", "scripts/docker-entrypoint.js"]
CMD ["node", "dist/src/main.js"]
