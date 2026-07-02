_Reverse-chronological record of shipped work — features, fixes, and chores. Newest first._

# 2026-07-03

- Stood up pg-boss as the run queue + scheduler on the existing Postgres (#47) — no Redis, no separate scheduler service (SPEC §24.0.1). All access goes through a new `Queue` interface (`QUEUE` token: `ensureQueue`/`enqueue`/`consume`/`schedule`/`cancel`), so the engine can later swap to BullMQ or Temporal without touching callers; queues default to retry-with-backoff plus a `<queue>.dead` dead-letter queue so failed work is inspectable, never dropped. Proven against real Postgres by a gated integration suite (enqueue/consume roundtrip, retries, dead-lettering, cron schedule persistence, deferred delivery). The module is deliberately not booted by the API yet — the durable-run pipeline (#48) and worker (#50) are its consumers.
- Type-checking now runs on **tsgo** (the TypeScript 7 Go port, `@typescript/native-preview` pinned): `apps/web`'s `typecheck` drops from ~6s to ~1s, and `apps/api` gains a `typecheck` script it never had (~0.6s) — closing the hole that let six latent spec type errors survive (specs are excluded from `nest build`, and nothing else built the full program). CI gates `turbo run typecheck`. Emit/build toolchains stay on TypeScript 5.x; tsgo is check-only. `apps/web`'s tsconfig drops `baseUrl` (removed in TS7; its `paths` were already tsconfig-relative, tsc 5.x semantics unchanged).
- Added **lefthook** pre-commit hooks (installed via the root `prepare` script on `pnpm install`): staged-file-scoped oxlint per workspace plus the api prettier check, parallel, sub-second on a typical commit; check-only by design — hooks never mutate files. Escape hatch: `git commit -n` / `LEFTHOOK=0`. Standing this up surfaced that oxlint's built-in `correctness` category defaults to *warn* severity, so the api's check-only lint (no `--deny-warnings`, unlike web/ui) gated nothing from that category — api's `.oxlintrc.json` now pins `correctness: error`.
- Migrated linting from ESLint to **oxlint** across all workspaces. Motivation: whole-repo linting was slow and memory-fragile — the api's typescript-eslint project service took ~12s alone and parallel `turbo lint` OOM'd locally; oxlint runs the same surface in ~1.1s total, parallel, with no Node-heap failure mode. The api keeps its full type-aware rule set (the `recommended-type-checked` equivalents, same warn/off overrides) via `oxlint-tsgolint`, which runs on tsgo — the official TypeScript 7 compiler — so typed rules like `no-floating-promises`/`no-unsafe-*` keep tsc-fidelity type information (~0.5s). `apps/web` and `packages/ui` gate with `--deny-warnings` as before; `packages/config-eslint` and the entire ESLint dependency tree are deleted. Formatting stays with prettier (benchmarked oxfmt: 6-7× faster but no markdown support and not byte-compatible — deliberately deferred until it matures): a new root `format:check` gates `apps/api/{src,test}` in CI, the surface the removed `eslint-plugin-prettier` used to enforce. Fallout the switch surfaced and fixed: `model-client.spec.ts` carried six latent type errors nothing ever checked (specs are excluded from `nest build` and ts-jest didn't flag them; tsgolint builds the full program), api's `tsconfig.json` drops `baseUrl` (tsgo removed it) and declares `"types": ["node", "jest"]` explicitly, and a stray unused-`.eslintrc.js` at the repo root plus a stale Biome VS Code recommendation are gone.

- Upgraded `apps/web` to Next.js 16 (15.5.19 → 16.2.10), following the official upgrade guide: `middleware.ts` renamed to `proxy.ts` (same cookie-presence gate; proxy always runs on the Node.js runtime, so the explicit `runtime` config is gone), Turbopack is now the default for both `next dev` and `next build` (dropped the `--turbopack` flag), and the removed `next lint` command is replaced by running ESLint directly (`eslint . --max-warnings 0`, same flat config). Along for the ride because Next 16 requires them: `@sentry/nextjs` 9 → 10 (v9 does not peer-support Next 16; v10's `withSentryConfig` is Turbopack-aware) and React pinned to ^19.2, plus `@next/eslint-plugin-next` 15 → 16 in the shared ESLint config. Async request APIs needed no changes — the app already awaited `params` and `cookies()`.

# 2026-07-02

- Added the llame vision document and linked it from agent context, clarifying the platform bets, current focus, emerging directions, and near-term non-goals; bumped the default OpenAI model to `gpt-5.4-mini` and added telemetry pricing for that default.
- Added test CI (#70): a GitHub Actions workflow gates every PR (and pushes to `master`) on `turbo run lint`, `turbo run build`, the api unit suite, and `apps/api/scripts/rls-test.sh` — the cross-tenant RLS proof and HTTP e2e against a throwaway Postgres, same script as local. Actions are SHA-pinned, `permissions: contents: read`, actionlint + zizmor clean. Standing up root lint surfaced that `packages/ui`'s lint had been silently broken forever (no `eslint` devDependency) — fixed, along with the three warnings it had been hiding.
- Chats are titled on the server again (#78, regression from the #63 thin-client cutover): after the first completed turn, a cheap post-turn model call names the still-untitled chat from the user's message (2–5 words, sanitized). Untitled is a first-class state — `chats.title` is now nullable and NULL means "awaiting generation"; clients render their own (localizable) placeholder, the DB never stores a display literal, and the atomic `WHERE title IS NULL` guard means a user rename mid-generation always wins. Same fire-and-forget post-turn shape as compaction — both ride into the durable-run worker with the loop (#50).
- Added the minimal Q&A eval set (#58) — **the last v0.1 line item**: happy-path, prompt-injection, and overflow/compaction cases run the real loop over HTTP against a real model; double-gated behind `RUN_MODEL_EVALS=1` so CI and `rls-test.sh` never spend tokens (`pnpm --filter api test:evals`). All three verified green live against OpenAI — the overflow case doubles as an end-to-end integration proof of provider config (#88) + compaction (#57): the chat compacts mid-conversation and a fact from the absorbed turns survives via the summary.
- Added lineage-based conversation context compaction (#57): when a chat's live context passes the trigger threshold, a post-turn model call summarizes the older turns into a first-class `compactions` row that records exactly what it supersedes (`upto_seq`) and chains to the compaction it absorbed (`parent_id`) — Hermes-style auditable lineage; messages are never deleted or mutated. The trigger prefers the real token usage the provider reported for the just-finished turn (char-estimate fallback), and the threshold derives from the model's context window (80%, via a small built-in catalog or `MODEL_CONTEXT_WINDOW_TOKENS`) with `COMPACTION_TOKEN_THRESHOLD` as explicit override. The summarization request is a cache-aligned continuation of the chat itself — same system prompt and history rendering as the turn that just ran, summarize instruction as the final user message — so the absorbed bulk is a provider prompt-cache read, not a fresh prefill. The next turn's context is summary + recent turns; the summarization call runs outside any DB transaction with a staleness guard against concurrent compactions. The pre-compaction most-recent-100 message cap is removed: a count cap silently drops old turns without any summary covering them whenever many short messages stay under the token threshold — tokens are the only context budget now. The new table ships with RLS `ENABLE`+`FORCE` and cross-tenant read/write denial proven in the RLS integration suite.
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
