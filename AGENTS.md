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

`compose.yaml` (repo root) runs Postgres for dev. One-time `cp apps/api/.env.example apps/api/.env.local`, then:

```bash
pnpm db:up        # start Postgres        ·   pnpm db:reset  # wipe + re-init
pnpm db:migrate   # apply apps/api migrations (the authoritative schema)
pnpm db:studio    ·   pnpm db:psql   ·   pnpm db:logs
```

Dev provisions a non-superuser role so RLS (incl. `FORCE`) is exercised as in production — the role model, the per-request `app.current_user_id` requirement, and `scripts/rls-test.sh` are documented in [apps/api/AGENTS.md](apps/api/AGENTS.md). `apps/web` still uses its own PoC schema and isn't wired to this DB yet (cutover pending).

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
- When work ships: add a dated `CHANGELOG.md` entry, and if it was on the roadmap, remove it from `ROADMAP.md`. Unplanned work (bug fixes, chores) goes straight to the changelog without ever appearing on the roadmap.

## Current state / gotchas

- The database schema currently exists in **both** `apps/web/lib/db` and `apps/api/src/db` — the DB is mid-migration out of the Next.js app into `apps/api` (commit `feat(api): move DB from the Next.js app`). Confirm which is authoritative before changing schema.
- Per SPEC.md §9.5 / §23.1, the agent/LangGraph layer in `apps/web` is slated to move to a dedicated `apps/api` worker. Don't deepen its coupling to the request/render path.
