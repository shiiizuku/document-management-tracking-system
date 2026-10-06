FROM node:26-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:4001/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
RUN npm ci
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN npm run build -w @dts/contracts && npm run build -w @dts/web

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
# As in the API image: the server is started with `node`, so npm and its dependencies — the only
# packages Trivy flagged here (D6) — are removed rather than shipped unused.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
  /usr/local/bin/yarn /usr/local/bin/yarnpkg
# Next.js standalone binds to $HOSTNAME, which Docker sets to the container id; the healthcheck
# probes 127.0.0.1, so bind every interface instead.
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# Owned by `node` because Next writes its image and fetch cache under .next at runtime.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
# Unprivileged, as the API image is: nothing in the web server needs root (D6).
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
