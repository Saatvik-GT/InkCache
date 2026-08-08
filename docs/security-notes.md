# Security notes

Standing decisions about dependency advisories, so they don't get
re-litigated (or "fixed" into something worse) on the next `npm audit`.

## react-router-dom stays on 7.18.x despite an open advisory

`npm audit` reports **GHSA-qwww-vcr4-c8h2** — "RSC Mode CSRF Bypass Allows
Action Execution Before 400 Response" — against `react-router` 7.12.0
through 8.2.0, and suggests `npm audit fix --force`.

**Do not run that.** It downgrades to 7.11.0, which is materially worse:
that version carries ten-plus advisories including a vendored
`turbo-stream` deserialization flaw leading to unauthenticated RCE, several
XSS vectors, and multiple open-redirect issues. Trading one inapplicable
advisory for a working RCE is a straight downgrade in safety.

Last verified against `npm view react-router-dom versions` on 2026-08-03.
7.18.2 is the latest published release as of that check; there is no
patched version to move to yet. Patch releases within 7.x don't change
this exemption's reasoning — the vulnerable range (7.12.0–8.2.0) covers
the whole 7.18.x line regardless, so bumping the patch version is safe to
do freely but doesn't affect the advisory either way.

### Why the advisory doesn't apply here

It requires React Router's **RSC mode / server actions**. This dashboard
uses only `BrowserRouter`, `Routes`, `Route` and `Link` — a fully
client-side SPA, statically built. There is no `createBrowserRouter`, no
data-router `action`/`loader`, no RSC, and no SSR anywhere in
`src/dashboard/src`, so the code path the advisory describes is never
reached.

### When to revisit

Move to the first release above 8.2.0 that carries the fix, once one
exists. Re-check with:

```bash
npm --prefix src/dashboard audit
grep -rn "createBrowserRouter\|RSC\|action:" src/dashboard/src
```

If that grep ever starts matching, this exemption is void and the version
needs re-evaluating immediately.

## autocannon (devDependency) drags in a moderate uuid advisory

`npm audit` reports **GHSA-w5hq-g745-h8pq** — "Missing buffer bounds check
in v3/v5/v6 when buf is provided" — against `uuid` &lt;11.1.1, reached via
`autocannon` → `hyperid` → `uuid`, and suggests `npm audit fix --force`.

**Do not run that.** It downgrades to `autocannon@2.0.1`, a five-major-
version regression to an ancient, unmaintained release for a benchmarking
tool that's a devDependency only — never installed in the production
Docker image, never runs against untrusted input, only ever invoked
locally by a developer running `npm run benchmark` against their own node.

### Why the advisory doesn't apply here

The advisory requires **`v3`, `v5`, or `v6`** of `uuid` **with a `buf`
parameter explicitly passed** (the missing bounds check is on writing into
that caller-supplied buffer). Read `node_modules/hyperid/hyperid.js`
directly: it calls `uuidv4()` — a different function, `v4`, not `v3`/`v5`/
`v6` — with **zero arguments**, no `buf` anywhere. Both conditions the
advisory requires are absent in how this dependency actually calls `uuid`.

### When to revisit

Re-check whenever `autocannon` gets updated (`npm outdated` in this repo):

```bash
npm ls hyperid uuid
grep -n "uuidv4\|uuid\.v[0-9]" node_modules/hyperid/hyperid.js
```

If hyperid's own `uuid` call site ever changes to pass a `buf` argument,
or to use `v3`/`v5`/`v6`, this exemption is void.
