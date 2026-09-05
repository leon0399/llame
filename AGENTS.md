# Agent instructions - llame

[SPEC.md](SPEC.md) indexes cross-cutting architecture; OpenSpec owns capability
behavior. `CLAUDE.md` and `GEMINI.md` link here.

@README.md

@CONTRIBUTING.md

@CODING_STANDARDS.md

@CLAUDE.local.md

`CLAUDE.local.md` is optional and gitignored; tracked instructions must not
depend on it.

## Documentation authority

- [REVIEW_GUIDE.md](REVIEW_GUIDE.md): reviewer judgment.
- [VISION.md](VISION.md), [ROADMAP.md](ROADMAP.md): direction and unshipped work.
- [SPEC.md](SPEC.md), [`openspec/specs`](openspec/specs): architecture and
  shipped behavior. [`openspec/changes`](openspec/changes) owns proposals and
  archives.
- [CHANGELOG.md](CHANGELOG.md): shipped chronology.
- [DESIGN.md](DESIGN.md): UI language.
- [docs/testing.md](docs/testing.md), [docs/scaling.md](docs/scaling.md): test
  placement and runtime topology.
- [`docs/research`](docs/research): noncanonical evidence.

Put commands and traps in the closest `AGENTS.md`, capability behavior in
OpenSpec, architecture in `SPEC.md`, and operator procedures in `docs/`. The
spec wins any disagreement.

## Repository

pnpm 11 + Turborepo; TypeScript throughout; Node >=22.19 (`.node-version` pins
22.23.1).

| Path                         | Owner                                                     |
| ---------------------------- | --------------------------------------------------------- |
| `apps/api`                   | API, services, database, co-located and dedicated workers |
| `apps/web`                   | thin Next.js client; no database                          |
| `apps/cli`                  | first-party terminal, separate local SQLite, remote HTTP client |
| `apps/storybook`             | Storybook runtime and browser tests                       |
| `packages/ui`                | shared shadcn components and stories                      |
| `packages/config-typescript` | shared tsconfig presets                                   |

## Root commands

```bash
pnpm install
pnpm dev
pnpm lint
pnpm format
pnpm test:mutation
pnpm test:mutation:check
pnpm test:mutation:dry
pnpm test:e2e
pnpm test:e2e:ui
pnpm test:e2e:headed
pnpm test:e2e:debug
pnpm test:e2e:report
```

Build workspaces sequentially. Use `pnpm --filter <workspace> build`; if a full
build is required, use `pnpm exec turbo run build --concurrency=1`. Never run
the unbounded root `pnpm build`.

Playwright owns its Postgres, migrations, API, model/MCP fixtures, and
production web build unless `POSTGRES_URL` points at an external database;
that database is neither started, reset, nor migrated. Stop services using its default ports
`4300/4301/55433/4302/4303/4304` and any Next process using `apps/web` before
E2E. Authenticated tests use `e2e/support/fixtures.ts`; destructive session
tests use `freshAccount`.

## Local database

Copy `apps/api/.env.example` to `apps/api/.env.local`, then:

```bash
pnpm db:up
pnpm db:reset
pnpm db:migrate
pnpm db:provision-rls
pnpm db:studio
pnpm db:psql
pnpm db:logs
```

`apps/api/src/db` owns the schema. See its
[AGENTS.md](apps/api/src/db/AGENTS.md) for migrations, RLS, and provisioning.

## Pre-launch evolution

Until the first production deployment:

- Remove obsolete internal code, schemas, APIs, aliases, and transitional paths
  directly. Do not add compatibility shims, dual reads/writes, or preservation
  backfills unless requested.
- Update internal callers and tests atomically.
- Test databases are disposable; Leo's running instance is not. Agree before a
  change discards its chats.
- Migration history is replaceable only with a coordinated baseline change.
  Never change statements in an already-applied migration without resetting
  every database that ran it; comment-only edits are safe.

These invariants remain: tenant tables use enabled and forced RLS with trusted
identity and fail closed; migrations remain transactional, idempotent, and
deterministic; secrets never reach logs, errors, model context, or owner output.

## Repository conventions

- Modified cyclomatic complexity stays `< 25`. Extract only at a responsibility
  boundary; no metric gaming or inline disables.
- Use Drizzle for DB access and generate migrations by default. A manual
  security/data step follows the SQL-comment contract in
  [apps/api/src/db/AGENTS.md](apps/api/src/db/AGENTS.md).
- Use conventional commits.
- Root `.oxlintrc.json` declares each rule once. Workspace configs only extend,
  scope environments, ignore generated/vendor files, or record narrow reviewed
  exceptions. Fix code rather than weakening a repository rule.
- `pnpm lint` owns repository rules. Chained assertions, including
  `as unknown as T`, are banned; narrow or validate the boundary.
- Product Markdown is part of `pnpm lint` and available directly through
  `pnpm lint:markdown`; lint commands reject unused disables.
- Follow [docs/testing.md](docs/testing.md). DB suites never skip silently.
- UI uses [DESIGN.md](DESIGN.md), shared primitives, and semantic tokens.
- Preserve `messages.parts` and stored order. Only declared display-only parts
  stay outside model history; compaction replaces only its explicit prefix.
  New replay transforms or omissions require a spec.

## Storybook MCP

When connected, Storybook tools are authoritative for props and stories. Read
story instructions before editing. After a rendered UI change, run story tests
and return preview URLs. For shared files without their own story, use consumer
stories.

## Security

- Identity comes only from authentication, never caller-controlled scope.
- Enforce tenant isolation in the datastore and fail closed without identity.
- Omit or gate any reachable surface that cannot yet be secured.
- Data/auth/tenancy changes state threats up front and ship a negative isolation
  test.
- Never expose credentials, resolved secret values, tokens, or host paths.
- Stop for a decision if a change may weaken isolation.

## Current runtime traps

- Every Chat Run uses pg-boss. HTTP enqueues and streams events;
  `RunExecutionService` stays transport-neutral.
