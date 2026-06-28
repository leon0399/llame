# apps/web

Next.js 15 App Router frontend and BFF: auth, chat UI, project/model surfaces, and — currently — the agent/model layer. Consumes shared UI from `@workspace/ui`.

## Stack

- Next.js 15 (App Router, Turbopack dev) + React 19
- Auth: NextAuth v5 (beta) + passkeys (`@simplewebauthn/*`), session via `@auth/drizzle-adapter`
- Server state: TanStack Query; HTTP via `ky`
- UI: shadcn/ui through `@workspace/ui`, Tailwind, framer-motion
- Agent/model: Vercel AI SDK v5 (beta) + LangChain / LangGraph (`langgraph-supervisor`) — see gotchas
- DB: Drizzle ORM + `postgres.js`
- Observability: Sentry (`@sentry/nextjs`), pino logs

## Structure

- `app/(auth)/` — NextAuth (`auth.ts`, `auth.config.ts`, `actions.ts`), login/register, `api/auth/[...nextauth]`
- `app/(chat)/` — chat UI + `api/v1/chats`; sidebar/header components
- `app/(models)/` — `api/v1/models`
- `lib/` — `ai/`, `db/` (schema + queries + `migrate.ts`), `services/`, `hooks/`, `appearance/`
- `components/`, `contexts/`, `hooks/`, `utils/`
- `middleware.ts` (NextAuth), `instrumentation*.ts` + `sentry.*.config.ts`

## Commands

```bash
pnpm --filter web dev        # next dev --turbopack
pnpm --filter web build
pnpm --filter web lint       # next lint  (lint:fix to autofix)
pnpm --filter web typecheck  # tsc --noEmit
pnpm --filter web db:generate    # drizzle-kit generate
pnpm --filter web db:migrate     # tsx lib/db/migrate.ts
pnpm --filter web db:studio      # drizzle-kit studio (also db:push / db:check)
```

## Setup

Copy `.env.example` to `.env`. Needs at minimum a Postgres `DATABASE_URL`, a NextAuth secret, and a model-provider key (OpenAI/Anthropic). Sentry DSN optional.

## Gotchas

- Route groups: `(auth)`, `(chat)`, `(models)`. HTTP routes are versioned under `app/(group)/api/v1/*`.
- `middleware.ts` runs NextAuth in the Node runtime — Next is pinned to 15.5.19 for stable node middleware (`fix(web): upgrade Next ... for stable node middleware`); be deliberate when bumping Next.
- The LangGraph agent loop lives here today but is slated to move to a dedicated `apps/api` worker (SPEC.md §9.5 / §23.1). Avoid deepening its coupling to the request/render path.
- `lib/db` overlaps with `apps/api/src/db` during the DB move — confirm the authoritative schema before editing.
