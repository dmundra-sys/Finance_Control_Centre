# ---- build stage -----------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm --prefix server ci && npm --prefix web ci
COPY server server
COPY web web
RUN npm --prefix web run build && npm --prefix server run build

# ---- runtime stage ---------------------------------------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production
# pg_dump / pg_restore are used by Backup & Recovery
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package*.json server/
RUN npm --prefix server ci --omit=dev
COPY --from=build /app/server/dist server/dist
COPY server/assets server/assets
COPY --from=build /app/web/dist web/dist
RUN mkdir -p /data/storage /data/backups && chown -R node:node /data /app
USER node
ENV STORAGE_DIR=/data/storage BACKUP_DIR=/data/backups PORT=4000
EXPOSE 4000
WORKDIR /app/server
CMD ["node", "dist/server.js"]
