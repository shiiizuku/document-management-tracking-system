FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
RUN npm ci
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN npm run build -w @dts/contracts && npm run build -w @dts/api
# Only runtime dependencies reach the image: the compilers, test runners and linters are build
# tools, and every package left in node_modules is one more thing a scanner reports and an
# attacker could reach (D6).
RUN npm prune --omit=dev

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
# The runtime starts `node` directly and never installs anything, so the package managers the base
# image bundles are removed: every finding Trivy reported in this image's OS layer was in npm's own
# dependencies (D6), none of which the application loads.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
  /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
# The seal the routing slip embeds. Resolved relative to the compiled module, so it has to sit
# beside dist/ in the image exactly as it does in the repo.
COPY --from=build /app/apps/api/assets ./apps/api/assets
# Unprivileged: the API, the worker and the migrator only read their own files and talk to the
# network, so nothing in the container needs root. `node` is the user the base image ships.
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
