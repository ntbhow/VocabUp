FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci

COPY backend ./backend
COPY frontend ./frontend
RUN npm run build
RUN npm run test -w backend
RUN npm prune --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=4000
WORKDIR /app

# Writable, disk-backed locations for uploaded illustrations and streamed APKG/CSV
# temp files. The container root is read-only, so these are mounted as volumes in
# docker-compose.production.yml / docker-compose.staging.yml.
RUN mkdir -p /app/uploads /var/tmp/vocabup && chown -R node:node /app/uploads /var/tmp/vocabup

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/migrations ./backend/migrations
COPY --from=build --chown=node:node /app/frontend/package.json ./frontend/package.json
COPY --from=build --chown=node:node /app/frontend/dist ./frontend/dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules

USER node
EXPOSE 4000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/dist/index.js"]
