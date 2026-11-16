# Multi-arch (amd64, arm64, arm/v7, arm/v6) server image. Open http://<host>:8080 in any browser.
FROM node:20-alpine
RUN apk add --no-cache tzdata su-exec
# Live stream for IPTV players (Admin > Stream) needs Chromium and ffmpeg. They add a few hundred MB, so they are only
# in the "stream" image (ghcr.io/torresmi9294/pidash:stream, or build with --build-arg STREAM=1 / PIDASH_STREAM=1).
# Chromium is not packaged for every CPU (not for 32-bit ARMv6): there the build still works and Stream says what is missing.
ARG STREAM=0
RUN if [ "$STREAM" = "1" ]; then \
      apk add --no-cache ffmpeg font-noto-emoji ttf-dejavu font-liberation \
      && { apk add --no-cache chromium || echo "NOTE: chromium is not available for this CPU, so the stream will not work here"; }; \
    fi
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
COPY widgets ./widgets
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data PIDASH_INSTALL=docker
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data
# Which commit this image was built from (set by CI), so the admin can tell when a newer image exists.
ARG GIT_SHA=""
RUN if [ -n "$GIT_SHA" ]; then echo "{\"sha\":\"$GIT_SHA\"}" > /app/.version; fi
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
