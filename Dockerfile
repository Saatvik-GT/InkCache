# InkCache cache node — multi-stage build: compile TypeScript to plain JS
# once at build time (tsconfig.build.json, src/core + src/network only),
# then run it with the bare `node` binary. Replaces transpiling via tsx on
# every container start, which cost real startup latency and meant tsx had
# to ship as a production dependency purely to exist at runtime.
FROM node:20-alpine AS build

WORKDIR /app

# Full install here (not --omit=dev) -- typescript itself is a devDependency
# and this stage's only job is to compile, never to run the server.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src/core ./src/core
COPY src/network ./src/network
RUN npx tsc -p tsconfig.build.json


FROM node:20-alpine

WORKDIR /app

# Only the backend's manifest -- the dashboard has its own package.json and
# isn't part of this image at all. --omit=dev skips concurrently/prettier/
# typescript/tsx/supertest entirely: none of them are needed to run
# already-compiled JS.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 8080

# Uses Node's own built-in fetch instead of wget/curl — those may or may
# not be present on a given alpine variant, but Node definitely is, that's
# the whole image. Lets an orchestrator (Compose, Render, etc.) tell
# "process started" apart from "actually answering requests". Reads
# INKCACHE_PORT from the container's own env at check-time rather than
# hardcoding 8080 — override the port (e.g. in docker-compose.yml) and
# this still checks the right one instead of silently going stale.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.INKCACHE_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node:20-alpine ships an unprivileged 'node' user (uid 1000) specifically
# for this — no reason to run an internet-facing process as root when the
# only thing it needs is read access to files root already copied in.
USER node

CMD ["node", "dist/network/server.js"]
