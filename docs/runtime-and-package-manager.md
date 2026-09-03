# Runtime and package manager

llame uses Node >=22.19 and pnpm 11. Revisit Bun only when all hard triggers
below change.

## Why Node remains

- Bun discourages `node:async_hooks`; request context carries trusted RLS
  identity and Sentry/OTel state.
- Worker-thread gaps conflict with durable-worker growth.
- Nest lacks first-party Bun support and had decorator-metadata regressions.
- Next/Turbopack and Playwright had runtime/multi-worker blockers.
- Signal handling affects API shutdown and queue/pool drains.
- llame is long-running and Postgres/LLM-bound; Bun's install/cold-start wins do
  not target current bottlenecks.

Bun as package manager alone saves little while losing pnpm patch/deploy,
requiring lockfile/CI/Nix changes, and weakening isolated-install maturity.

Reopen when Bun supports async hooks, Nest supports Bun, and Playwright's
multi-worker blocker closes. Production Nest evidence and resolved Turbopack
issues are secondary. First adoption should be a new isolated service, not an
in-place API migration.

## pnpm contracts

- Put dependencies shared by two or more workspaces in
  `pnpm-workspace.yaml`'s `catalog:`.
- `allowBuilds` is the reviewed install-script allowlist; unlisted scripts are
  blocked.
- Keep `enableGlobalVirtualStore` off: tsgo resolves global-store realpaths into
  split `@types` identities. Revisit when tsgo supports that layout.
- Stay current on pnpm 11. Security/build defaults are pinned in
  `pnpm-workspace.yaml`; `minimumReleaseAge` is seven days and `engineStrict`
  lives there. pnpm 12 is #634.
