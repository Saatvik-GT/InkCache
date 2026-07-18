# InkCache Dashboard

React + Vite + Tailwind monitor for a local InkCache node — see the
[repo root README](../../readme.md) for the full project and
[`docs/api.md`](../../docs/api.md) for the API this talks to.

## Local dev

```bash
npm install
npm run dev   # :5173, proxies /api to the node on :8080
```

Run from the repo root instead (`npm run dev`) to start the cache node
and this dashboard together.

## Build

```bash
npm run build   # typecheck + production build to dist/
```
