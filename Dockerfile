FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json index.ts cli.ts ./
COPY src ./src
COPY types ./types

RUN npm run build \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

# Keep the database under a directory that already belongs to the unprivileged
# node user. Docker will populate a new named volume from this directory on the
# first mount, so LanceDB remains writable without running the service as root.
RUN mkdir -p /app/data/memory-server \
  && touch /app/data/memory-server/.volume-init \
  && chown -R node:node /app

USER node

EXPOSE 7337

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:7337/health').then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/src/server/main.js"]

