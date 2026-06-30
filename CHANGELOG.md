_Reverse-chronological record of shipped work — features, fixes, and chores. Newest first._

# 2026-06-30

- Completed the `apps/web` thin-client cutover (#63): removed its database, NextAuth adapter/JWT, and the LangGraph chat/models routes — the browser now calls `apps/api` directly at `NEXT_PUBLIC_API_URL` for `/auth/v1` (login/register/logout) and `/api/v1` (chats + streaming). Layered auth-state (middleware cookie-presence gate → authoritative api guard → client `401` interceptor; `GET /auth/v1/me` as source of truth), with one shared 401 handler across the ky client and the AI SDK chat transport. Added config-driven CORS allowlist + session-cookie `Domain` on `apps/api`.
- Added the `apps/api` single-model streaming chat loop (#55): guarded `POST /api/v1/chats/:id/messages`, server-authoritative context, idempotent client message ids, AI SDK UI-message SSE streaming, assistant persistence with usage, and abort/cross-tenant/fail-fast e2e coverage.

# 2026-06-29

- Shipped the v0.1 multi-tenant chat foundation (#53, #59): `chats`/`messages` schema (AI SDK v5 `role`+`parts`, sender-attributed) with a monotonic `seq` ordering key, a `chat_visibility` enum, and a deterministic, cache-aware `ContextBuilder`.
- Row-Level Security `ENABLE`d **and** `FORCE`d on `chats`/`messages`, engaged per request via `TenantDbService.runAs` (transaction-local `app.current_user_id`); cross-tenant isolation proven against real Postgres (`apps/api/scripts/rls-test.sh`).
- Local dev database via docker-compose (`pnpm db:up` / `db:migrate` / `db:studio` / `db:psql` / `db:reset`), provisioning a non-superuser app role so RLS is exercised as in production.
- Added the `apps/api` `/auth/v1` surface (#60): register, login, current user, and revocable server-side session resources backed by opaque tokens hashed at rest.
- Security: re-exposed chat HTTP endpoints under `/api/v1` only behind verified sessions, so `TenantDbService.runAs` is fed by trusted auth context instead of client-supplied `ownerUserId`.

# 2026-06-28

- Authored the product specification ([SPEC.md](SPEC.md)) and refined it to v0.3: single TypeScript stack, Postgres-first architecture, corrected single-`SKILL.md` skill format — verified via a multi-reviewer pass.
- Added hierarchical `CLAUDE.md` context files (root + `apps/web`, `apps/api`, `packages/ui`).
- Pinned Next.js to 15.5.19 for stable Node middleware; documented OpenAI/Anthropic API keys in `.env.example`.

# 2025-10-20

- Dependency updates (Next.js, axios).

# 2025-07-29

- Moved the database out of the Next.js app into the NestJS API.

# 2025-07-28

- Scaffolded the NestJS API app.
- Chat error display; `Alert` UI component.

# 2025-07-18

- Experimented with multi-agent / expert-supervision orchestration.

# 2025-07-16

- Persist and fetch user chats via the API/DB.
- Agent supervisor/orchestrator and ReAct agent for chat.
- Added Sentry.

# 2025-07-15

- User info in the sidebar.

# 2025-07-14

- Theme switch and font-family setting (incl. OpenDyslexic), with server-side cookie persistence.
- Model preview card in the selector; upgraded AI SDK to beta.

# 2025-07-09

- Per-message model selection; styled messages, auto-scroll container, and message components; dropped the completions PoC.

# 2025-07-03

- Stateless chat PoC; test chat + completions APIs; message-input, code-block, and markdown components.

# 2025-07-02

- Models API + query; PoC conversation tree; fixed the auth DB connection in middleware.

# 2025-06-30

- Core chat UI shell: sidebar (mock chats/projects), model selector, and shadcn UI kit (dialog, popover, command, dropdown, sidebar).
- React Query wiring; simple auth/register pages.

# 2025-06-29

- Project bootstrapped (shadcn/ui monorepo); Sonner toaster.
