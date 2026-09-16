---
paths:
  - "go.mod"
  - "go.sum"
  - "frontend/package.json"
  - "frontend/pnpm-lock.yaml"
---

# Before adding a dependency

`agent_docs/DEPENDENCIES.md` is the policy and the inventory, with a one-line
rationale for every direct dependency and a record of what was considered and
rejected. It is a decision record rather than a lockfile mirror, so read it
before adding anything and record the addition there in the same pull request.

The short version:

- **Go:** prefer the standard library. This app runs local-first on the user's
  machine, so every dependency is something that has to be vetted, updated and
  trusted with local file and process access. Justify anything beyond the
  existing surface.
- **npm:** prefer what is already in the tree over a second library doing the
  same job. Anything heavy or rarely used must be lazy-loaded via `React.lazy`
  + `Suspense`, and added to `lib/prefetch.ts`'s warm list with the same
  specifier, or the cost simply moves to the first open of the tile.
- Check `pnpm check-bundle` (165 KB gzip entry chunk) is not blown by the
  addition.

`DEPENDENCIES.md` also tracks the system build dependencies Linux needs, which
are not Go or npm packages and which the release CI installs by name.
