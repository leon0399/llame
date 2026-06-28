# llame

Self-hosted, multi-user personal AI assistant platform — chat, projects, knowledge spaces, durable agent runs, artifacts, BYOK models, MCP/connectors, skills, and messaging channels. This repo is the implementation; the product spec and roadmap live in [SPEC.md](SPEC.md).

## Monorepo layout

pnpm + Turborepo workspace, **TypeScript end-to-end** (Node >= 20, pnpm 10). Workspaces: `apps/*`, `packages/*`.

| Path | Role | Stack (details in its own `CLAUDE.md`) |
|------|------|----------------------------------------|
| `apps/web` | User-facing app + BFF (auth, chat/project UI); currently also hosts the agent layer | Next.js 15 (App Router), React 19, NextAuth v5, AI SDK + LangGraph, Drizzle |
| `apps/api` | Backend services + database ownership; future home of the durable run worker | NestJS 11, Drizzle + postgres.js |
| `packages/ui` | Shared shadcn/ui component library (`@workspace/ui`) | shadcn/ui, Tailwind, React 19 |
| `packages/config-eslint` | Shared ESLint configs (`base`, `next-js`, `react-internal`) | — |
| `packages/config-typescript` | Shared `tsconfig` bases | — |

Each app/package has its own `CLAUDE.md` (auto-loaded when you work in that directory) with concrete commands, structure, and gotchas. **Keep this file high-level — put implementation detail in the child file, not here.**

## Commands (from repo root)

```bash
pnpm install
pnpm dev      # turbo dev — all apps in watch mode
pnpm build    # turbo build
pnpm lint     # turbo lint
pnpm format   # prettier --write **/*.{ts,tsx,md}
```

Scope to one workspace with `pnpm --filter web <script>` (or `--filter api`).

## Conventions

- TypeScript only across web/api/worker — no second backend language (SPEC.md §23).
- Drizzle ORM for all DB access; generate migrations with `drizzle-kit`, never hand-write migration SQL.
- Conventional commits (e.g. `feat(api):`, `docs(spec):`).

## Current state / gotchas

- The database schema currently exists in **both** `apps/web/lib/db` and `apps/api/src/db` — the DB is mid-migration out of the Next.js app into `apps/api` (commit `feat(api): move DB from the Next.js app`). Confirm which is authoritative before changing schema.
- Per SPEC.md §9.5 / §23.1, the agent/LangGraph layer in `apps/web` is slated to move to a dedicated `apps/api` worker. Don't deepen its coupling to the request/render path.
