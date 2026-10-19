# Multi-arch (amd64, arm64, arm/v7, arm/v6) server image. Open http://<host>:8080 in any browser.
FROM node:20-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
COPY widgets ./widgets
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "server/index.js"]
