_Reverse-chronological record of shipped work — features, fixes, and chores. Newest first._

# 2026-07-02

- Made the chat loop's OpenAI-compatible provider configurable (#88): `OPENAI_BASE_URL` and `OPENAI_MODEL` env vars on `apps/api` point dev and the upcoming eval suite (#58) at any OpenAI-compatible endpoint (OpenRouter free tier, groq, a local model) instead of hardcoded paid `api.openai.com`; documented the OpenRouter setup in `.env.example`. A v0.1 dev/eval stopgap — the native OpenRouter provider and BYOK credential vault remain v0.4 (#37/#82).

# 2026-07-01

- Added per-chat deep links for the web chat (#77): `/chat/[id]` now server-loads persisted history through `apps/api`, sidebar chat rows navigate to stable chat URLs, New Chat resets to `/` with a fresh draft id, and SSR history reads are bounded by a short timeout instead of waiting indefinitely on a stalled API.

# 2026-06-30

- Upgraded the Vercel AI SDK off its pre-stable beta line: `ai` 5.0.0-beta.12 → 6.0.217, `@ai-sdk/react` → 3.0.219 (`apps/web`), `@ai-sdk/openai` → 3.0.79 (`apps/api`), staged through v5-stable and v6 with `@ai-sdk/codemod` for the v6 hop. Stopped at v6 rather than v7: `ai@7.0.0` dropped CommonJS support entirely (ESM-only, no `require` export condition), which `apps/api`'s NestJS/CommonJS build can't consume without a module-system migration — deferred to whenever the durable-run worker (#50) is built, since that's a new process that can reasonably start as ESM. `apps/api`'s `ContextBuilder` now delivers the chat's system prompt via `streamText`'s native `system` param instead of a `role: 'system'` entry in `messages` (the AI SDK warns on the latter as of v6, and v7 rejects it outright).
- Refreshed the `packages/ui` shadcn/ui kit to current upstream: migrated all primitives from the individual `@radix-ui/react-*` packages to the unified `radix-ui` package, re-pulled the latest component source (new `Button` `xs`/`icon-*` sizes and `data-variant`/`data-size`, flatter default surfaces), and bumped `lucide-react` 0.475 → 1.x. No design-token changes — `globals.css` stays monochrome.
- Added shadcn staple components to `@workspace/ui`: `badge`, `tabs`, `switch`, `spinner`, `toggle`, `toggle-group`, and `alert-dialog`.
- Fixed the collapsed-sidebar user avatar squashing into a vertical rectangle: the trigger now uses `SidebarMenuButton size="lg"` (which zeroes padding when collapsed) instead of a manual `h-12`, so the 8×8 avatar stays square in icon mode.
- Replaced the hand-rolled `<kbd>` shortcut hints in the sidebar with `@workspace/ui`'s official `Kbd` component, surfaced both inline (on hover, expanded) and in the collapsed-state tooltip — using the same `has-data-[slot=kbd]` flex-gap idiom shadcn applies on `Button`, since `TooltipContent` doesn't ship it by default.
- Added per-assistant-turn telemetry in `apps/api` (#56): assistant messages now persist token usage including cached input tokens and reasoning tokens, model/provider, latency, finish reason/status, and best-effort `costUsd`; completed turns emit a structured pino trace keyed by chat/message ids without message content.
- First message now **creates the chat** in one call (#86): `POST /api/v1/chats/:id/messages` upserts the chat for a client-supplied id before streaming (idempotent `createIfAbsent`, mirroring the user-message upsert). The id is routing/idempotency only — the owner stays server-derived, and a cross-tenant id collision returns 404 (no hijack, no existence leak), proven by RLS-integration and e2e tests. Eliminates the empty-chat orphan left behind when a first send failed (e.g. the 402 no-model-key case, which now persists nothing). `apps/web` drops the create-then-stream machinery (the `queuedMessage`/`queuedChatId` queue and the remount-on-`activeChatId` dance): it mints the chat id up front and keys the session by it, so adopting the id on first send streams without a remount. Dropped the now-unused `POST /api/v1/chats` empty-chat endpoint — chats are created exclusively by their first message.
- Added Playwright browser E2E coverage for the auth cutover (#79): the Playwright harness starts a throwaway Docker Postgres, applies migrations, starts `apps/api` + `apps/web`, reuses worker-scoped authenticated storage state, and verifies login success/failure, callback redirect safety, no-cookie redirects, logout, and revoked-session redirect behavior.
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
