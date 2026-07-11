# apps/web

Next.js 16 App Router frontend. `apps/web` is a thin browser client of `apps/api`: it owns UI state and calls `NEXT_PUBLIC_API_URL` directly for auth and chat. Consumes shared UI from `@workspace/ui`.

## Stack

- Next.js 16 (App Router, Turbopack dev + build) + React 19
- Auth: api-owned revocable sessions; browser calls `/auth/v1` with `credentials: 'include'`
- Server state: TanStack Query; HTTP via `ky`
- UI: shadcn/ui through `@workspace/ui`, Tailwind, framer-motion
- Chat transport: Vercel AI SDK v6 `DefaultChatTransport` streaming from `apps/api`
- DB: none in web; `apps/api` is the sole DB owner
- Observability: Sentry (`@sentry/nextjs`)

## Structure

- `app/(auth)/` — login/register UI; calls `apps/api` `/auth/v1`
- `app/(chat)/` — chat UI; streams via `apps/api` `/api/v1/chats`
- `lib/` — `api/`, `services/`, `hooks/`, `appearance/`, static model display data
- `components/`, `contexts/`, `hooks/`, `utils/`
- `proxy.ts` (cookie-presence gate; Next 16's rename of `middleware.ts`), `instrumentation*.ts` + `sentry.*.config.ts`

## Commands

```bash
pnpm --filter web dev        # next dev (Turbopack is the Next 16 default)
pnpm --filter web build
pnpm --filter web lint       # oxlint --deny-warnings  (lint:fix to autofix)
pnpm --filter web test       # vitest run  (test:watch to watch)
pnpm --filter web typecheck  # tsgo --noEmit (TypeScript 7 Go port; emit/build stays on TS 5.x)
```

## Setup

Copy `.env.example` to `.env.local`. Needs `NEXT_PUBLIC_API_URL` pointing at `apps/api`. Sentry DSN optional.

## Gotchas

- Route groups: `(auth)` and `(chat)`.
- `proxy.ts` is a cookie-presence UX gate only. It must not import NextAuth, touch the DB, or call api per request. `apps/api` guards are authoritative.
- `useMe()` is auth-critical: keep `staleTime: 0` and `refetchOnMount: 'always'` despite the global QueryClient stale time.
- The chat transport bypasses ky. Keep the shared `authAwareFetch` wired into `DefaultChatTransport` as well as the ky client.
- Chat history/message reads are server state. Route them through TanStack Query query keys/hooks; SSR-loaded history must seed React Query via `initialData` or hydration before `useChat` consumes it. Do not pass server-fetched messages directly into chat UI state. Keep draft/new-chat message queries disabled until the chat exists server-side.
- Chat query keys live in `lib/services/chat/queries.ts` as a feature key factory. Keep keys as serializable arrays from generic resource to specific resource/subresource (`["chats"]`, `["chats", "list"]`, `["chats", chatId, "messages"]`). Use `chatQueryKeys.lists()` for chat-list invalidation and `chatQueryKeys.messages(chatId)` for message history. Query functions that depend on key variables must read them from `QueryFunctionContext`, not from a separate closure.
- Mutations follow the reference pattern in `lib/services/org-units/mutations.ts`: a mutation-key factory mirroring the query-key factory, plain fetchers as `mutationFn`, and optimistic cache patches only where the next state is client-computable (cancel → snapshot → patch → rollback-on-error → always-invalidate-on-settled). Creations/grants that need server-assigned fields (id, path, createdAt, …) stay invalidate-on-success only, never optimistic.
