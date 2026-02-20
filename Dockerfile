FROM node:22-slim AS build

WORKDIR /app

ARG TARGETARCH
ENV YARN_CACHE_FOLDER=/usr/local/share/.cache/yarn/$TARGETARCH

COPY package.json yarn.lock ./
COPY .npmrc* ./

RUN --mount=type=cache,target=/usr/local/share/.cache/yarn/$TARGETARCH,sharing=locked \
    corepack enable && yarn install --frozen-lockfile

COPY . .
RUN yarn build

# Production stage
FROM node:22-slim

WORKDIR /app

ARG TARGETARCH
ENV YARN_CACHE_FOLDER=/usr/local/share/.cache/yarn/$TARGETARCH
ENV NODE_ENV=production

COPY package.json yarn.lock ./
COPY .npmrc* ./

RUN --mount=type=cache,target=/usr/local/share/.cache/yarn/$TARGETARCH,sharing=locked \
    corepack enable && yarn install --frozen-lockfile --production

COPY --from=build /app/lib ./lib

RUN rm -f .npmrc

EXPOSE 3100

CMD ["node", "lib/index.js"]
