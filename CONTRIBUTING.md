# Contributing to InkCache

This project is developed as part of CUSoC under mentor guidance, but
standard open-source hygiene still applies.

## Local setup

```bash
npm install
npm --prefix src/dashboard install
npm run dev        # cache node on :8080 + dashboard on :5173
npm run test:watch # re-runs core + API tests on save, while iterating
```

**On Windows**, run `npm install`/`npm ci` from PowerShell or `cmd.exe`,
not Git Bash — installing from Git Bash makes npm link `tsx` and
`concurrently`'s executables as bare Unix symlinks with no `.cmd`/`.ps1`
wrapper, which native Windows shells can't run (`'tsx' is not recognized
as an internal or external command...`). If you hit that error, delete
`node_modules` and reinstall from PowerShell.

## Before opening a PR

```bash
npm run check                           # typecheck + format:check + test in one go
npm --prefix src/dashboard run lint     # oxlint
npm --prefix src/dashboard run build    # dashboard typecheck + build
npm run docker:build                    # only strictly needed if you touched the Dockerfile
```

`npm run check` is `typecheck && format:check && test` — the three pure
local checks that don't need the dashboard's own dependencies or Docker.

CI builds the Docker image and runs it (`curl`s `/health` before tearing
it down), so a broken `CMD`/`PORT`/startup crash gets caught there too —
`npm run docker:run` locally is for iterating on the Dockerfile itself,
not required before every PR.

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
