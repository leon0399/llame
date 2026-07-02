_Reverse-chronological record of shipped work — features, fixes, and chores. Newest first._

# 2026-07-02

- Consolidation pass over the overnight branch: fixed two masked lint errors in the chat loop (an untyped `let run` and unsafe `String()` coercions in the unique-violation matcher — the local lint wrapper had hidden them; CI would have failed), and closed an at-least-once-delivery seam in the worker: a redelivered queue job whose run is already executing (fresh heartbeat) is now skipped instead of starting a second model call, while a stale running run still accepts the redelivery as crash recovery.
- Refresh-safe resume proven in a real browser — #49 and #80 closed: a new Playwright chat-flow suite runs the full stack (web + api in **worker execution mode** + throwaway Postgres + a deterministic mock OpenAI-compatible model server wired via `OPENAI_BASE_URL`) and proves create → stream → render plus the headline: reload the page mid-answer and the run survives, resumes, and completes on screen. The whole browser suite (12 tests) now runs against worker mode — standing soak evidence for flipping `RUN_EXECUTION_MODE`'s default (#50). Along the way, fixed a latent #88 bug: the model client hit OpenAI's proprietary `/responses` endpoint, which OpenAI-_compatible_ providers don't implement — it now uses `/chat/completions` (works everywhere, OpenAI included). Auth throttle limits became env-tunable (`AUTH_RATE_LIMIT_PER_MINUTE`) so parallel e2e workers from one IP don't starve the fixtures; production default stays strict.
- Wired resume-on-refresh into the web chat (#49 client side): `DefaultChatTransport` now carries a `prepareReconnectToStreamRequest` pointing at `GET /chats/:id/stream`, and persisted chats mount with `resume: true` — reloading a chat mid-run reconnects to the active run's UI-message stream and picks up live (draft chats skip the probe; an idle chat's 204 resolves to a no-op). Verified by web unit tests, typecheck/build, and the full 10-test Playwright browser suite against the live api+web stack. The end-to-end browser proof of a mid-run refresh needs the Playwright API in worker mode — the remaining step to close #49.
- Added the stream-resume endpoint (#49 API side): `GET /api/v1/chats/:id/stream` returns the chat's active run as an AI SDK UI-message stream — a page refresh mid-run replays every persisted delta and continues live to completion — or `204` when there is nothing to resume (a cross-tenant or unknown chat id answers the same 204: no existence leak). Matches the AI SDK v6 `reconnectToStream` transport contract, so the `apps/web` hookup is a small transport method; "the active run" is well-defined thanks to per-chat single-flight. Proven in worker-mode e2e: disconnect mid-run → resume replays the full ordered chunk stream.
- Auth hardening, second tranche (#68): **rate limiting** via `@nestjs/throttler` — a generous instance-wide ceiling (300/min) with strict 10/min per-IP limits on `login`/`register` (each attempt burns a bcrypt compare), the throttle guard running _before_ session validation so floods never pay the session lookup; proven by a 429 e2e. And **expired-session housekeeping** on a pg-boss cron (`sessions.cleanup`, hourly) — #47's scheduler's first production consumer; the purge is idempotent across instances and proven against real Postgres. Remaining in #68: cross-site CSRF posture, token-free cookie responses, session rotation (vacuous until a change-password endpoint exists).
- Auth surface hardening, first tranche (#68): the API is now **fail-closed by default** — `SessionAuthGuard` is a global `APP_GUARD` and only routes explicitly marked `@Public()` (login, register, the liveness root) skip it, so a future controller added without thinking about auth yields 401s instead of a silently public endpoint (per-route guards were removed so the global one is load-bearing and proven by the existing 401 e2e tests). Session validation is now **atomic** (validity re-checked in the same `UPDATE … RETURNING` that stamps `last_seen_at`, closing the TOCTOU window) with a 60s read-only debounce that takes the per-request write off the hot path; session listing filters expired rows (+ index); the current-session lookup is a single query; and `TRUST_PROXY` makes `session.ip` record the real client behind a reverse proxy (off by default — fail closed). Still open in #68: login/register rate limiting, cross-site CSRF posture, and the token-free cookie response.
- Closed out the #55 streaming-loop hardening deferrals (#73): `in_reply_to` integrity now holds at the database (a trigger rejects replies linked across chats or to non-user messages, whichever code path writes them — proven with negative tests); the e2e fake model client aborts on the abort **event** (not a post-hoc poll), with a new fidelity test proving a mid-stream abort fires `onError`, never `onFinish`, and persists no partial text; and the unit fake now fires `onFinish` on stream **consumption** (pull-driven), matching real AI SDK timing. Single-flight, the fourth item, shipped with #48.
- Per-chat single-flight (#48, closing its acceptance list): a partial unique index admits at most one non-terminal run per chat — the DB-level guarantee against concurrent double model calls (#73, deferred from #55). A different message sent while a run is in flight gets a clean 409 with its whole transaction rolled back; a **retry of the same message supersedes** its prior attempt (cancelled + evented + in-process abort) so a silently-died turn is always retryable. `markStarted` and worker pickup now refuse terminal runs, so a superseded queued run can never be resurrected. The v0.1 "overlapping turns" e2e was rewritten to the new serialized contract.
- Zombie runs now expire (#48 heartbeat + timeout): the executing worker stamps a per-run heartbeat, and every enqueued run gets its own delayed **deadman job** (pg-boss `startAfter` — no cross-tenant reaper scan, so the RLS moat stays intact): terminal runs are left alone, fresh-heartbeat runs are re-checked later, and a run whose heartbeat went stale (worker crash/hang) is marked `expired` with a `run.failed` event. Terminal statuses are now immutable at the repository level (first writer wins), so a late-finishing stream can never overwrite `expired`/`cancelled`. All knobs configurable (`RUN_TIMEOUT_SECONDS`, `RUN_HEARTBEAT_STALE_SECONDS`, `RUN_HEARTBEAT_SECONDS`); proven in worker-mode e2e with a hand-crafted zombie.
- Runs are cancellable (#48): `PATCH /api/v1/runs/:id` with `{status: "cancelled"}` (resource PATCH per house REST rules, not a verb handle) stamps `cancel_requested_at` — the durable, cross-process signal — and aborts the in-process controller when the run is executing locally. A still-queued run is settled as `cancelled` at worker pickup without touching the model; a mid-flight run aborts through the same path a client abort used in inline mode. Idempotent re-cancel returns 200, a finished run 409, cross-tenant 404 — all proven in worker-mode e2e.
- Runs can now execute in a queue worker (#48/#50, flag-gated): with `RUN_EXECUTION_MODE=worker`, `POST /chats/:id/messages` only validates, stores, creates the run, and enqueues it on pg-boss; a co-located consumer drives the identical `RunExecutionService`, and the HTTP response streams from the durable run-event log through a new UI-message bridge speaking the AI SDK protocol — the existing web client works unchanged, and **closing the connection mid-run no longer kills the turn** (proven by a disconnect e2e: the run completes, the assistant message persists). Default stays `inline` pending soak; cancellation, heartbeat/timeout, and flipping the default remain in #48/#50.
- Extracted run execution out of the HTTP path (staging #50): a new transport-agnostic `RunExecutionService` owns context assembly, the model call, and every durable side effect (assistant turn, run lifecycle + delta events, post-turn compaction/titling); `ChatLoopService` shrinks to the SPEC §9.5 API-side steps — validate, store message, create run, hand off. Behavior-preserving (full e2e parity); the worker move (#50) now swaps one hand-off call for an enqueue.
- Added test CI (#70): a GitHub Actions workflow gates every PR (and pushes to `master`) on `turbo run lint`, `turbo run build`, the api unit suite, and `apps/api/scripts/rls-test.sh` — the cross-tenant RLS proof and HTTP e2e against a throwaway Postgres, same script as local. Actions are SHA-pinned, `permissions: contents: read`, actionlint + zizmor clean. Standing up root lint surfaced that `packages/ui`'s lint had been silently broken forever (no `eslint` devDependency) — fixed, along with the three warnings it had been hiding.
- Made durable runs observable and replayable (#48/#49 API side): the loop now persists coalesced `model.delta` events (size-buffered via a pure delta-buffer, ordered by a sequential write chain), and a new run read surface exposes `GET /api/v1/runs/:id` plus the SPEC §9.4 cursor SSE `GET /api/v1/runs/:id/events?after_sequence=N` — each frame's SSE `id:` is its event sequence, an in-flight run is polled until terminal, a finished run streams its tail and closes, and a reconnect resumes from the last id with nothing lost. Cross-tenant reads 404 on both endpoints (proven in e2e). The `apps/web` resume-on-refresh client remains open in #49.
- Landed the durable-run substrate (#48, first slice): `runs` and append-only `run_events` tables (SPEC §9.3–§9.4) with RLS `ENABLE`+`FORCE` and cross-tenant read/write denial proven live. Every user message now creates a run **in the same transaction** as the message, and the streaming loop dual-writes an ordered lifecycle log (`run.created` → `run.started` → `model.requested` → `model.completed` → `run.completed`/`run.failed`/`run.cancelled`) — the durable source of truth the SSE replay (#49) will read. Still to come in #48: the worker consuming from pg-boss, token-delta events, cancellation/heartbeat/timeout, and per-chat single-flight (deliberately deferred until heartbeat exists, since without it a crashed run would deadlock its chat).
- Stood up pg-boss as the run queue + scheduler on the existing Postgres (#47) — no Redis, no separate scheduler service (SPEC §24.0.1). All access goes through a new `Queue` interface (`QUEUE` token: `ensureQueue`/`enqueue`/`consume`/`schedule`/`cancel`), so the engine can later swap to BullMQ or Temporal without touching callers; queues default to retry-with-backoff plus a `<queue>.dead` dead-letter queue so failed work is inspectable, never dropped. Proven against real Postgres by a gated integration suite (enqueue/consume roundtrip, retries, dead-lettering, cron schedule persistence, deferred delivery). The module is deliberately not booted by the API yet — the durable-run pipeline (#48) and worker (#50) are its consumers.
- Chats are titled on the server again (#78, regression from the #63 thin-client cutover): after the first completed turn, a cheap post-turn model call names the still-default chat from the user's message (2–5 words, sanitized), persisted through an atomic `WHERE title = 'New chat'` guard so a user rename mid-generation always wins. Same fire-and-forget post-turn shape as compaction — both ride into the durable-run worker with the loop (#50).
- Added the minimal Q&A eval set (#58) — **the last v0.1 line item**: happy-path, prompt-injection, and overflow/compaction cases run the real loop over HTTP against a real model; double-gated behind `RUN_MODEL_EVALS=1` so CI and `rls-test.sh` never spend tokens (`pnpm --filter api test:evals`). All three verified green live against OpenAI — the overflow case doubles as an end-to-end integration proof of provider config (#88) + compaction (#57): the chat compacts mid-conversation and a fact from the absorbed turns survives via the summary.
- Added lineage-based conversation context compaction (#57): when a chat's estimated context passes a configurable token threshold (`COMPACTION_TOKEN_THRESHOLD`), a post-turn model call summarizes the older turns into a first-class `compactions` row that records exactly what it supersedes (`upto_seq`) and chains to the compaction it absorbed (`parent_id`) — Hermes-style auditable lineage; messages are never deleted or mutated. The next turn's context is summary + recent turns; the summarization call runs outside any DB transaction with a staleness guard against concurrent compactions. The new table ships with RLS `ENABLE`+`FORCE` and cross-tenant read/write denial proven in the RLS integration suite.
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
