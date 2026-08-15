# llame API

The `api` workspace is llame's NestJS backend and sole database owner. It serves
the authenticated HTTP API, enqueues durable runs through pg-boss, and hosts the
co-located and dedicated worker entrypoints.

## Responsibilities

- Own the Drizzle schema, migrations, tenant transactions, and RLS integration.
- Expose the code-first OpenAPI contract committed as `openapi.json`.
- Execute durable chat runs through transport-independent application services.
- Keep the web application a thin API client with no database access.

## Commands

Run workspace commands from the repository root:

```bash
pnpm --filter api dev
pnpm --filter api build
pnpm --filter api lint
pnpm --filter api typecheck
pnpm --filter api test
pnpm --filter api test:mutation:dry
pnpm --filter api test:mutation
pnpm --filter api test:integration
```

The integration suite provisions its own PostgreSQL container unless
`TEST_DATABASE_URL` is supplied. The workspace-scoped build regenerates the
committed OpenAPI document.

The two mutation commands are a bounded, foreground-only diagnostic for the
three pure MCP utilities and their direct unit tests. They are not a coverage
substitute or a CI gate. Stryker and the installed Vitest runner each use one
worker; do not raise concurrency without new peak-memory evidence. The native
clear-text summary is printed by the run, while HTML and JSON reports are
written under the ignored `apps/api/reports/mutation/` directory. The full run
may need scoped sandbox permission for Stryker's internal Node logging-server
bind; it does not require external network access, and the dry run may not
reach that bind. Keep the native configuration—no bespoke wrapper, reporter, or
checker.

## Documentation

- [API agent instructions](./AGENTS.md) define commands, boundaries, testing,
  database ownership, and security requirements.
- [Architecture contract](../../SPEC.md) defines the cross-cutting system
  invariants.
- [Testing](../../docs/testing.md) and [scaling](../../docs/scaling.md) document
  the test pyramid and durable-worker topology.
