# InkCache cache node — runs the TypeScript source directly via tsx (same
# as `npm run start:node` locally), no separate compile step to drift out
# of sync with the source. Single stage: this is a small demo backend, not
# a project that benefits from a multi-stage build/runtime split yet.
FROM node:20-alpine

WORKDIR /app

# Only the backend's manifest — the dashboard has its own package.json and
# isn't part of this image at all.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/core ./src/core
COPY src/network ./src/network

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npx", "tsx", "src/network/server.ts"]
