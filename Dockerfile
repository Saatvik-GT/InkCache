# InkCache cache node — runs the TypeScript source directly via tsx (same
# as `npm run start:node` locally), no separate compile step to drift out
# of sync with the source. Single stage: this is a small demo backend, not
# a project that benefits from a multi-stage build/runtime split yet.
FROM node:20-alpine

WORKDIR /app

# Only the backend's manifest — the dashboard has its own package.json and
# isn't part of this image at all. --omit=dev skips concurrently/prettier/
# typescript/supertest entirely — tsx lives in "dependencies" specifically
# so it's still installed (it's the actual runtime, not a dev tool here).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src/core ./src/core
COPY src/network ./src/network

ENV NODE_ENV=production
EXPOSE 8080

# Uses Node's own built-in fetch instead of wget/curl — those may or may
# not be present on a given alpine variant, but Node definitely is, that's
# the whole image. Lets an orchestrator (Compose, Render, etc.) tell
# "process started" apart from "actually answering requests".
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node:20-alpine ships an unprivileged 'node' user (uid 1000) specifically
# for this — no reason to run an internet-facing process as root when the
# only thing it needs is read access to files root already copied in.
USER node

CMD ["npx", "tsx", "src/network/server.ts"]
