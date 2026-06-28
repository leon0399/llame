# apps/api

NestJS 11 backend: API + services, and owner of the database schema/migrations. Future home of the durable run worker (SPEC.md §9.5).

## Stack

- NestJS 11 (`@nestjs/*`), Express platform
- DB: Drizzle ORM via `@knaadh/nestjs-drizzle-postgres` + `postgres.js`; migrations with `drizzle-kit`
- Tests: Jest (+ SWC); e2e under `test/`

## Structure

- `src/` — feature modules, each as controller + service + module (`chats/`, `users/`)
- `src/db/` — `schema/` (`auth.ts`, `chats.ts`), `migrations/` (+ `meta/` journal), `migrate.ts`
- `src/main.ts`, `src/app.module.ts`

## Commands

```bash
pnpm --filter api dev          # nest start --watch
pnpm --filter api build        # nest build  (start:prod -> node dist/main)
pnpm --filter api test         # jest  (also test:e2e, test:cov)
pnpm --filter api db:generate  # drizzle-kit generate from src/db/schema
pnpm --filter api db:migrate   # tsx src/db/migrate.ts
pnpm --filter api db:studio    # drizzle-kit studio (also db:push / db:check)
```

## Conventions

- One NestJS module per feature (controller / service / module); wire via DI and register in `app.module.ts`.
- Schema lives in `src/db/schema`; change it, then `db:generate`. Never hand-edit migration SQL or `meta/_journal.json`.

## Gotchas

- Schema currently overlaps with `apps/web/lib/db` (the DB is being moved out of `web` into here) — keep the two from diverging until the move is finished.
