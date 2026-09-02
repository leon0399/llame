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

The mutation commands cover API product source with unit tests and the
TypeScript checker. CI runs stable source-file shards and aggregates their JSON
reports before enforcing MSI. Reports are ignored under `reports/`. Restricted
sandboxes may need local-bind permission for Stryker.

## Documentation

- [API agent instructions](./AGENTS.md) define commands, boundaries, testing,
  database ownership, and security requirements.
- [Architecture contract](../../SPEC.md) defines the cross-cutting system
  invariants.
- [Personal Knowledge operator runbook](../../docs/knowledge.md) defines the
  configured root, worker mounts, live-file authority, and security boundary.
- [Testing](../../docs/testing.md) and [scaling](../../docs/scaling.md) document
  the test pyramid and durable-worker topology.
