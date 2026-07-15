# Agent instructions — llame

How to work in this repo. [SPEC.md](SPEC.md) is the current cross-cutting architecture contract and documentation index; focused capability behavior lives in OpenSpec. `CLAUDE.md` and `GEMINI.md` are symlinks to this file.

The product overview (what llame is) is short and always relevant, so it is imported in full:

@README.md

## Key documentation

- [README.md](README.md) — current product overview, shipped baseline, and quickstart (imported above)
- [VISION.md](VISION.md) — north-star direction, principles, horizons, and deliberate deferrals
- [ROADMAP.md](ROADMAP.md) — forward-only sequence of unshipped work; GitHub owns live status and implementation detail
- [SPEC.md](SPEC.md) — current cross-cutting architecture contract, enforced invariants, and authority index
- [`openspec/specs`](openspec/specs) — normative shipped capability behavior; [`openspec/changes`](openspec/changes) owns proposed deltas and archived implementation records
- [CHANGELOG.md](CHANGELOG.md) — shipped chronology
- [`docs/research`](docs/research) — noncanonical evidence, alternatives, and decision provenance
- [DESIGN.md](DESIGN.md) — design system reference (visual language, OKLCH tokens, component stylings); consult before building or restyling any UI
- [docs/scaling.md](docs/scaling.md) — horizontal-scaling topology, invariants, and the design constraints for the durable-run worker split (#48/#50)

## Monorepo layout

pnpm + Turborepo workspace, **TypeScript end-to-end** (Node >= 22.12, pinned in `.node-version`; `nix develop` or direnv gives a ready shell; pnpm 10). Workspaces: `apps/*`, `packages/*`.

| Path                         | Role                                                                                      | Stack (details in its own `AGENTS.md`)                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/web`                   | User-facing **thin client** of `apps/api` (auth, chat/project UI); owns no DB             | Next.js 16 (App Router), React 19, TanStack Query, AI SDK (chat transport), ky |
| `apps/api`                   | API/services + **sole database owner**; ships co-located and dedicated worker entrypoints | NestJS 11, Drizzle + postgres.js, pg-boss                                      |
| `packages/ui`                | Shared shadcn/ui component library (`@workspace/ui`)                                      | shadcn/ui, Tailwind, React 19                                                  |
| `packages/config-typescript` | Shared `tsconfig` bases                                                                   | —                                                                              |

Each app/package has its own `AGENTS.md` (auto-loaded when you work in that directory) with concrete commands, structure, and gotchas. **Keep this file high-level — put implementation detail in the child file, not here.**

## Commands (from repo root)

```bash
pnpm install
pnpm dev      # turbo dev — all apps in watch mode
pnpm build    # turbo build
pnpm lint     # turbo lint (oxlint per workspace; type-aware via tsgolint in apps/api)
pnpm format   # prettier --write **/*.{ts,tsx,md}   (format:check to verify)
pnpm test:e2e            # playwright test; pass filters after --, e.g. pnpm test:e2e -- e2e/auth
pnpm test:e2e:ui         # playwright test --ui
pnpm test:e2e:headed     # playwright test --headed
pnpm test:e2e:debug      # playwright test --debug
pnpm test:e2e:report     # playwright show-report
```

Scope to one workspace with `pnpm --filter web <script>` (or `--filter api`).
Install Playwright browsers once with `pnpm exec playwright install chromium` if the local browser cache is missing. For E2E, Playwright starts a throwaway Docker Postgres, applies migrations, then starts `apps/api` and `apps/web`; set `POSTGRES_URL` only to use an already-migrated external database instead. Authenticated E2E tests should use the worker-scoped fixture from `e2e/fixtures.ts`, which writes per-worker storage state under `.auth/`; destructive session tests should request `freshAccount`. Override `E2E_WEB_PORT`, `E2E_API_PORT`, `E2E_DB_PORT`, or `E2E_DB_READY_PORT` only when the default E2E ports (`4300`/`4301`/`55433`/`4302`) conflict. Next.js 16 enforces one dev instance **per project directory**, not per port — `pnpm test:e2e`'s own `next dev --port 4300` refuses to start (and the whole run fails) while a manual `pnpm dev`/`next dev` is running anywhere against `apps/web`, even on a different port; stop the manual dev server first.

## Local database (docker)

`compose.yaml` (repo root) runs Postgres for dev. One-time `cp apps/api/.env.example apps/api/.env.local`, then:

```bash
pnpm db:up        # start Postgres        ·   pnpm db:reset  # wipe + re-init
pnpm db:migrate   # apply apps/api migrations (the authoritative schema)
pnpm db:provision-rls # assign privileged RLS helper ownership after migrations
pnpm db:studio    ·   pnpm db:psql   ·   pnpm db:logs
```

Dev provisions a non-superuser role so RLS (incl. `FORCE`) is exercised as in production — the role model, the per-request `app.current_user_id` requirement, and `scripts/rls-test.sh` are documented in [apps/api/AGENTS.md](apps/api/AGENTS.md). `apps/api` is the sole DB owner; `apps/web` holds no database connection and reads/writes only through `apps/api` (SPEC.md §22.0).

## Conventions

- TypeScript only across web/api/worker — no second backend language (SPEC.md §23).
- Drizzle ORM for all DB access; generate migrations with `drizzle-kit`, never hand-write migration SQL.
- Conventional commits (e.g. `feat(api):`, `docs(spec):`).
- UI work follows the design language in [DESIGN.md](DESIGN.md) — compose `@workspace/ui` primitives and the semantic tokens; no ad-hoc colors or a brand hue (see its §10 Do/Don't).

## Security

llame is multi-tenant and self-hosted: tenant isolation is a core invariant. Weigh security on every change that touches data, auth, tenancy, identity, secrets, or an externally reachable surface. These are the durable principles — concrete mechanics live in the relevant app's `AGENTS.md` and focused OpenSpec capability specs; SPEC.md indexes the cross-cutting contract:

- **Authorization identity comes only from a trusted, authenticated source** — never from client-controlled input (params, body, query, headers). Never scope data access by a value the caller can set.
- **Enforce isolation in the datastore, not just app code** (defense-in-depth), and make sure the app actually engages it. When identity or scope is absent, **fail closed** (deny), never open.
- **Don't ship a reachable surface that can't yet be secured.** If the guard doesn't exist, gate the surface or omit it — a code comment is not a mitigation.
- **Security is an acceptance criterion, not a follow-up.** Any change touching data/auth/tenancy states its isolation and threat considerations up front and ships a negative test (e.g. cross-tenant access is denied).
- **Secrets stay secret** — never commit, log, print, or echo credentials, keys, or tokens; provider credentials are currently operator-managed through `llame.config.json` secret references.
- **Surface risk, don't bury it.** If a change could weaken isolation, or you're unsure, say so explicitly and stop for a decision — don't defer silently.

## Maintaining ROADMAP & CHANGELOG

- `ROADMAP.md` is forward-only — it lists work that is **not yet done**.
- `CHANGELOG.md` is the dated record of everything **shipped** — features, bug fixes, and chores alike — newest first.
- **Update both in the same PR that ships the work, not after.** The PR's own diff adds the dated `CHANGELOG.md` entry and, if the work was on the roadmap, removes it from `ROADMAP.md` — so the changelog is correct the moment the PR merges, with no separate follow-up commit. Unplanned work (bug fixes, chores) goes straight to the changelog without ever appearing on the roadmap.

## Current state / gotchas

- `apps/api/src/db` is the single source of truth for the schema. `apps/web` owns no database or chat backend — it is a thin API client (SPEC.md §22.0).
- Every chat run executes via the pg-boss queue (#107; there is no inline request-thread mode): the api enqueues and answers with the run-event stream bridge, while co-located consumers or the shipped no-HTTP `apps/api/src/worker.ts` entrypoint execute (`RunsWorkerService` → transport-agnostic `RunExecutionService` — don't couple it to HTTP).
