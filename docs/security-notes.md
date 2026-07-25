# Security notes

Standing decisions about dependency advisories, so they don't get
re-litigated (or "fixed" into something worse) on the next `npm audit`.

## react-router-dom stays on 7.18.1 despite an open advisory

`npm audit` reports **GHSA-qwww-vcr4-c8h2** — "RSC Mode CSRF Bypass Allows
Action Execution Before 400 Response" — against `react-router` 7.12.0
through 8.2.0, and suggests `npm audit fix --force`.

**Do not run that.** It downgrades to 7.11.0, which is materially worse:
that version carries ten-plus advisories including a vendored
`turbo-stream` deserialization flaw leading to unauthenticated RCE, several
XSS vectors, and multiple open-redirect issues. Trading one inapplicable
advisory for a working RCE is a straight downgrade in safety.

7.18.1 is the latest published release; there is no patched version to move
to yet.

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
