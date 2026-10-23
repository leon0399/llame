# apps/web

Next.js 16 App Router client. It owns browser/UI state and calls `apps/api` for
auth, chat, and product persistence; local UI preferences may use cookies. It
has no database.

Before changing Next behavior, read the relevant installed guide under
`node_modules/next/dist/docs/`. Next 16 may differ from remembered APIs.

## Stack and structure

- React 19, TanStack Query, Tailwind, shadcn via `@workspace/ui`, Sentry.
- Non-streaming HTTP uses generated Orval Fetch bindings. AI SDK
  `DefaultChatTransport` owns chat streams.
- `app/(auth)/`: login/register; `app/(chat)/`: chat UI.
- `lib/`: API policies, feature services, hooks, appearance, and model display.
- `proxy.ts`: cookie-presence UX gate; API guards remain authoritative.

## Commands

```bash
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web typecheck
```

Copy `.env.example` to `.env.local`; set `NEXT_PUBLIC_API_URL`. Sentry is
optional: set `NEXT_PUBLIC_SENTRY_DSN` to report. Events are tagged `local`
unless the build sets `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (`.env.example` sets
`development`).
To open `next dev` from another device (for example over Tailscale), set
`ALLOWED_DEV_ORIGINS` to that host, leave `NEXT_PUBLIC_API_URL` unset (the
browser then calls the API on its own host, port 3001), add the web origin
to the API's `WEB_ORIGIN`, and run the API with `NODE_ENV=development`.

## Traps

- Follow [docs/development/testing.md](../../docs/development/testing.md) for component-story versus
  jsdom placement.
- `proxy.ts` must not query the API or database. `useMe()` keeps `staleTime: 0`
  and `refetchOnMount: "always"`.
- Components and routes use handwritten feature services for runtime calls;
  generated model types may be imported type-only. See
  [`lib/api/AGENTS.md`](lib/api/AGENTS.md).
- Chat send, reconnect, and run-event streams bypass generated bindings and use
  `authAwareFetch`; generated calls must not buffer them.
- Chat history is TanStack Query state. Seed SSR data through hydration or
  `initialData`; do not pass it directly into `useChat` state. Disable draft
  message queries until the Chat exists.
- Query keys are serializable arrays from general to specific and live in
  feature factories. Query functions read variables from
  `QueryFunctionContext`.
- Mutations follow `lib/services/org-units/mutations.ts`: optimistic updates
  only when the client can compute the complete next state; otherwise
  invalidate after success. The optimistic sequence is cancel, snapshot, patch,
  rollback on error, then always invalidate on settle.
