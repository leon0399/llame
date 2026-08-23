# Agent instructions — @workspace/harness

Canonical home of the framework-free harness core extracted from
`apps/api`. See [README.md](README.md) for contents; consumers are `apps/api`
and `apps/cli`.

## Commands

```bash
pnpm --filter @workspace/harness build       # tsc → dist (consumers resolve this)
pnpm --filter @workspace/harness test        # vitest, node env, globals on
pnpm --filter @workspace/harness lint typecheck
```

## Gotchas

- **Consumers resolve `dist`**, not source: rebuild this package before
  api/cli lint/typecheck/test after changing it. Their package-scoped
  `turbo.json` encodes the ordering; direct `pnpm --filter` runs bypass it.
- Code moved here from `apps/api` is **verbatim where possible** — keep the
  provenance comments and disable directives intact; they satisfy the shared
  anti-slop oxlint config (this workspace copies apps/api's `.oxlintrc.json`).
- `Tool<TArgs, TContext>` is generic over the trusted context: hosts bind
  their own (API: RLS identity; CLI: workspace root). Don't re-hardcode a
  host-specific context here.
- Tests use vitest globals (`describe`/`it`) without imports — matching the
  API suites that moved here.
