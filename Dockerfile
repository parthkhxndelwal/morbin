# syntax=docker/dockerfile:1.7
#
# Morbin — single-server production image.
# Build:  docker compose build app
# The runtime stage contains only the Next standalone output: no source, no
# dev dependencies, no build tooling, and it runs as an unprivileged user.

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Public, build-time values only. Secrets are injected at runtime by compose.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_RAZORPAY_KEY_ID
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_RAZORPAY_KEY_ID=${NEXT_PUBLIC_RAZORPAY_KEY_ID}
RUN npm run build

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MEDIA_DIR=/data/media \
    DOCUMENTS_DIR=/data/documents
RUN addgroup -S -g 1001 morbin && adduser -S -u 1001 -G morbin morbin \
    && mkdir -p /data/media /data/documents && chown -R morbin:morbin /data
COPY --from=build --chown=morbin:morbin /app/.next/standalone ./
COPY --from=build --chown=morbin:morbin /app/.next/static ./.next/static
COPY --from=build --chown=morbin:morbin /app/public ./public
USER morbin
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
