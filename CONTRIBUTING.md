# Contributing to InkCache

This project is developed as part of CUSoC under mentor guidance, but
standard open-source hygiene still applies.

## Local setup

```bash
npm install
npm --prefix src/dashboard install
npm run dev        # cache node on :8080 + dashboard on :5173
```

## Before opening a PR

```bash
npm test                 # core + API tests (node:test)
npx tsc --noEmit          # backend typecheck
npm run format:check     # prettier — repo-wide
npm --prefix src/dashboard run lint    # oxlint
npm --prefix src/dashboard run build   # dashboard typecheck + build
npm run docker:build                    # only strictly needed if you touched the Dockerfile
```

CI builds the Docker image too (catches a broken `Dockerfile`), but
doesn't run it — `npm run docker:run` + `curl localhost:8080/health` is
still on you if you actually changed backend behavior inside the image.

## Workflow

1. Create an issue describing the feature/bug.
2. Branch off `main` (`git checkout -b feature/your-feature`).
3. Commit with conventional-style messages (`feat:`, `fix:`, `docs:`, ...)
   describing what changed and why.
4. Open a PR referencing the issue.
5. Address review feedback before merge.

## Scope

Keep additions small and functional — see the "Current Status" section of
the README for what's in scope for the current milestone before adding new
surface area.
