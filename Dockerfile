FROM node:22-slim AS build

# Corepack reads the pinned `packageManager` in package.json, so the toolchain
# is the one the lockfile was resolved with rather than whatever the base image
# ships.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /app

RUN corepack enable

# The manifests first: an install layer only changes when a dependency does, so
# an edit to a source file reuses the fetched tree instead of resolving again.
COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/server/package.json ./packages/server/
COPY packages/contract/package.json ./packages/contract/
COPY packages/client/package.json ./packages/client/

RUN yarn install --immutable

COPY tsconfig.base.json tsconfig.json ./
COPY packages/server ./packages/server
COPY packages/contract ./packages/contract
COPY packages/client ./packages/client

RUN yarn build

# The runtime image carries the built server, its static files, the built
# contract, and nothing else: the workspace dependency is the only module the
# server resolves, and the install of devDependencies is not shipped.
FROM node:22-slim

WORKDIR /app

COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/public ./packages/server/public
COPY --from=build /app/packages/contract/package.json ./packages/contract/package.json
COPY --from=build /app/packages/contract/dist ./packages/contract/dist

# A copy, not the workspace symlink the install produced: the runtime layout
# stands alone, so `import("@hexagen-monaco/waves-contract")` resolves from
# /app/packages/server with no workspace tree above it.
COPY --from=build /app/packages/contract/package.json \
  ./node_modules/@hexagen-monaco/waves-contract/package.json
COPY --from=build /app/packages/contract/dist \
  ./node_modules/@hexagen-monaco/waves-contract/dist

WORKDIR /app/packages/server

ENV WAVES_DATA_DIR=/data \
    WAVES_PORT=8080 \
    NODE_ENV=production

# node:22-slim ships this account as uid 1000, gid 1000.
USER node

EXPOSE 8080

# Probes belong to the orchestrator: Kubernetes asks for /healthz itself.
CMD ["node", "dist/main.js"]