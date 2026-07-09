FROM node:22-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG TARGETARCH
ENV YARN_CACHE_FOLDER=/usr/local/share/.cache/yarn/$TARGETARCH

COPY package.json yarn.lock ./
COPY .npmrc* ./

# --network-timeout: the arm64 leg builds under QEMU emulation where TLS/IO are
# slow enough that large tarballs (viem, @x402/paywall's wallet deps) blow past
# yarn's 30s default and fail with ESOCKETTIMEDOUT.
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn/$TARGETARCH,sharing=locked \
    corepack enable && yarn install --frozen-lockfile --network-timeout 600000

COPY . .
RUN yarn build

# Remove devDependencies — native addons for production deps are already compiled.
# Same cache mount as the full install so this resolves from the warm cache
# instead of re-downloading everything over the network.
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn/$TARGETARCH,sharing=locked \
    yarn install --frozen-lockfile --production --ignore-scripts --network-timeout 600000

# Production stage
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/lib ./lib
COPY --from=build /app/abis ./abis

EXPOSE 3100

CMD ["node", "lib/index.js"]
