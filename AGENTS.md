# Agent instructions — llame

How to work in this repo. For the full product/architecture spec, see [SPEC.md](SPEC.md). `CLAUDE.md` and `GEMINI.md` are symlinks to this file.

The product overview (what llame is) is short and always relevant, so it is imported in full:

@README.md

## Key documentation

- [README.md](README.md) — what llame is (product overview, quickstart; imported above)
- [SPEC.md](SPEC.md) — full product & architecture specification
- [ROADMAP.md](ROADMAP.md) — planned milestones (forward-looking)
- [CHANGELOG.md](CHANGELOG.md) — shipped history

## Monorepo layout

pnpm + Turborepo workspace, **TypeScript end-to-end** (Node >= 20, pnpm 10). Workspaces: `apps/*`, `packages/*`.

| Path | Role | Stack (details in its own `AGENTS.md`) |
|------|------|----------------------------------------|
| `apps/web` | User-facing app + BFF (auth, chat/project UI); currently also hosts the agent layer | Next.js 15 (App Router), React 19, NextAuth v5, AI SDK + LangGraph, Drizzle |
| `apps/api` | Backend services + database ownership; future home of the durable run worker | NestJS 11, Drizzle + postgres.js |
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
```

Scope to one workspace with `pnpm --filter web <script>` (or `--filter api`).

## Local database (docker)

`compose.yaml` at the repo root runs Postgres for development. It provisions a
**non-superuser `app` role that owns the schema**, so Row-Level Security (incl. `FORCE`)
is exercised in dev exactly as in a self-hosted deployment — a superuser would silently
bypass the multi-tenant moat.

```bash
cp apps/api/.env.example apps/api/.env.local   # one-time: POSTGRES_URL → the app role
pnpm db:up        # start Postgres (docker compose up -d)
pnpm db:migrate   # apply apps/api migrations (the authoritative schema)
pnpm db:studio    # drizzle-kit studio    ·    pnpm db:psql    ·    pnpm db:logs
pnpm db:reset     # wipe the volume and re-init (re-runs the app-role setup)
```

Migrations run from the host against **`apps/api`** (authoritative). `apps/web` still
uses its own PoC schema and is not yet wired to this database (cutover pending). The RLS
moat can be re-proven end-to-end with `apps/api/scripts/rls-test.sh`.

## Conventions

- TypeScript only across web/api/worker — no second backend language (SPEC.md §23).
- Drizzle ORM for all DB access; generate migrations with `drizzle-kit`, never hand-write migration SQL.
- Conventional commits (e.g. `feat(api):`, `docs(spec):`).

## Maintaining ROADMAP & CHANGELOG

- `ROADMAP.md` is forward-only — it lists work that is **not yet done**.
- `CHANGELOG.md` is the dated record of everything **shipped** — features, bug fixes, and chores alike — newest first.
- When work ships: add a dated `CHANGELOG.md` entry, and if it was on the roadmap, remove it from `ROADMAP.md`. Unplanned work (bug fixes, chores) goes straight to the changelog without ever appearing on the roadmap.

## Current state / gotchas

- The database schema currently exists in **both** `apps/web/lib/db` and `apps/api/src/db` — the DB is mid-migration out of the Next.js app into `apps/api` (commit `feat(api): move DB from the Next.js app`). Confirm which is authoritative before changing schema.
- Per SPEC.md §9.5 / §23.1, the agent/LangGraph layer in `apps/web` is slated to move to a dedicated `apps/api` worker. Don't deepen its coupling to the request/render path.
