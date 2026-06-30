# Agent instructions — llame

How to work in this repo. For the full product/architecture spec, see [SPEC.md](SPEC.md). `CLAUDE.md` and `GEMINI.md` are symlinks to this file.

The product overview (what llame is) is short and always relevant, so it is imported in full:

@README.md

## Key documentation

- [README.md](README.md) — what llame is (product overview, quickstart; imported above)
- [SPEC.md](SPEC.md) — full product & architecture specification
- [ROADMAP.md](ROADMAP.md) — planned milestones (forward-looking)
- [CHANGELOG.md](CHANGELOG.md) — shipped history
- [DESIGN.md](DESIGN.md) — design system reference (visual language, OKLCH tokens, component stylings); consult before building or restyling any UI

## Monorepo layout

pnpm + Turborepo workspace, **TypeScript end-to-end** (Node >= 20, pnpm 10). Workspaces: `apps/*`, `packages/*`.

| Path | Role | Stack (details in its own `AGENTS.md`) |
|------|------|----------------------------------------|
| `apps/web` | User-facing **thin client** of `apps/api` (auth, chat/project UI); owns no DB | Next.js 15 (App Router), React 19, TanStack Query, AI SDK (chat transport), ky |
| `apps/api` | Backend services + **sole database owner**; future home of the durable run worker | NestJS 11, Drizzle + postgres.js |
| `packages/ui` | Shared shadcn/ui component library (`@workspace/ui`) | shadcn/ui, Tailwind, React 19 |
| `packages/config-eslint` | Shared ESLint configs (`base`, `next-js`, `react-internal`) | — |
| `packages/config-typescript` | Shared `tsconfig` bases | — |

Each app/package has its own `AGENTS.md` (auto-loaded when you work in that directory) with concrete commands, structure, and gotchas. **Keep this file high-level — put implementation detail in the child file, not here.**

## Commands (from repo root)

```bash
pnpm install
pnpm dev      # turbo dev — all apps in watch mode
pnpm build    # turbo build
pnpm lint     # turbo lint
pnpm format   # prettier --write **/*.{ts,tsx,md}
pnpm test:e2e            # playwright test; pass filters after --, e.g. pnpm test:e2e -- e2e/auth
pnpm test:e2e:ui         # playwright test --ui
pnpm test:e2e:headed     # playwright test --headed
pnpm test:e2e:debug      # playwright test --debug
pnpm test:e2e:report     # playwright show-report
```

Scope to one workspace with `pnpm --filter web <script>` (or `--filter api`).
Install Playwright browsers once with `pnpm exec playwright install chromium` if the local browser cache is missing. For E2E, start/migrate Postgres first (`pnpm db:up && pnpm db:migrate`) or point `POSTGRES_URL` at an already-migrated database; override `E2E_WEB_PORT` and `E2E_API_PORT` only when the default E2E ports (`4300`/`4301`) conflict.

## Local database (docker)

`compose.yaml` (repo root) runs Postgres for dev. One-time `cp apps/api/.env.example apps/api/.env.local`, then:

```bash
pnpm db:up        # start Postgres        ·   pnpm db:reset  # wipe + re-init
pnpm db:migrate   # apply apps/api migrations (the authoritative schema)
pnpm db:studio    ·   pnpm db:psql   ·   pnpm db:logs
```

Dev provisions a non-superuser role so RLS (incl. `FORCE`) is exercised as in production — the role model, the per-request `app.current_user_id` requirement, and `scripts/rls-test.sh` are documented in [apps/api/AGENTS.md](apps/api/AGENTS.md). `apps/api` is the sole DB owner; `apps/web` holds no database connection and reads/writes only through `apps/api` (SPEC.md §22.0).

## Conventions

- TypeScript only across web/api/worker — no second backend language (SPEC.md §23).
- Drizzle ORM for all DB access; generate migrations with `drizzle-kit`, never hand-write migration SQL.
- Conventional commits (e.g. `feat(api):`, `docs(spec):`).
- UI work follows the design language in [DESIGN.md](DESIGN.md) — compose `@workspace/ui` primitives and the semantic tokens; no ad-hoc colors or a brand hue (see its §10 Do/Don't).

## Security

llame is multi-tenant and self-hosted: tenant isolation is a core invariant. Weigh security on every change that touches data, auth, tenancy, identity, secrets, or an externally reachable surface. These are the durable principles — concrete mechanics live in the relevant app's `AGENTS.md` and in SPEC.md:

- **Authorization identity comes only from a trusted, authenticated source** — never from client-controlled input (params, body, query, headers). Never scope data access by a value the caller can set.
- **Enforce isolation in the datastore, not just app code** (defense-in-depth), and make sure the app actually engages it. When identity or scope is absent, **fail closed** (deny), never open.
- **Don't ship a reachable surface that can't yet be secured.** If the guard doesn't exist, gate the surface or omit it — a code comment is not a mitigation.
- **Security is an acceptance criterion, not a follow-up.** Any change touching data/auth/tenancy states its isolation and threat considerations up front and ships a negative test (e.g. cross-tenant access is denied).
- **Secrets stay secret** — never commit, log, print, or echo credentials, keys, or tokens; provider keys are user-owned (BYOK).
- **Surface risk, don't bury it.** If a change could weaken isolation, or you're unsure, say so explicitly and stop for a decision — don't defer silently.

## Maintaining ROADMAP & CHANGELOG

- `ROADMAP.md` is forward-only — it lists work that is **not yet done**.
- `CHANGELOG.md` is the dated record of everything **shipped** — features, bug fixes, and chores alike — newest first.
- **Update both in the same PR that ships the work, not after.** The PR's own diff adds the dated `CHANGELOG.md` entry and, if the work was on the roadmap, removes it from `ROADMAP.md` — so the changelog is correct the moment the PR merges, with no separate follow-up commit. Unplanned work (bug fixes, chores) goes straight to the changelog without ever appearing on the roadmap.

## Current state / gotchas

- `apps/api/src/db` is the single source of truth for the schema. `apps/web` owns no database or chat backend — it is a thin API client (SPEC.md §22.0).
- The v0.1 single-model chat loop runs **in the `apps/api` HTTP request path** today; per SPEC.md §9.5 / §23.1 it moves into a dedicated durable-run worker in v0.2 (#50). Don't deepen its coupling to the request/response path.
