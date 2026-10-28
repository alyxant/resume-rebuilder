FROM node:20-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    HOME=/tmp/libreoffice-home

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      libreoffice-core \
      libreoffice-writer \
      fonts-dejavu-core \
      fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data /tmp/libreoffice-home

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["npm", "start"]
