---
type: Research
title: "Server-to-client push for record changes: signal, transport and AsyncAPI contracts"
description: "Separates the missing change signal from the transport choice, recommends Postgres NOTIFY pointers fanned out over one owner-scoped stream of invalidation DTOs, and uses AsyncAPI 3.0 as generated documentation over the same @nestjs/swagger DTOs that orval already turns into client types."
tags: [realtime, websocket, sse, listen-notify, asyncapi, openapi, dto, codegen]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-16T00:00:00Z }
observed: { date: 2026-10-16, revision: e0c36fdaa }
sources:
  - id: issue-118
    resource: "https://github.com/leon0399/llame/issues/118"
    title: "feat(api): push-based live run deltas (LISTEN/NOTIFY) instead of polling"
  - id: issue-207
    resource: "https://github.com/leon0399/llame/issues/207"
    title: "Cross-process mid-flight run cancellation"
  - id: pg-notify
    resource: "https://www.postgresql.org/docs/17/sql-notify.html"
    title: "PostgreSQL 17 NOTIFY"
  - id: postgresjs-listen
    resource: "https://github.com/porsager/postgres/tree/v3.4.7#listen--notify"
    title: "postgres.js 3.4.7 listen and notify"
  - id: nestjs-asyncapi
    resource: "https://www.npmjs.com/package/nestjs-asyncapi/v/2.0.1"
    title: "nestjs-asyncapi 2.0.1"
  - id: asyncapi-bindings
    resource: "https://github.com/asyncapi/bindings"
    title: "AsyncAPI protocol bindings"
  - id: asyncapi-3-schema-format
    resource: "https://www.asyncapi.com/docs/reference/specification/v3.0.0#multiFormatSchemaObject"
    title: "AsyncAPI 3.0.0 Multi Format Schema Object"
---

# Server-to-client push for record changes

## Finding

The transport is the cheap part. llame has no change signal: every live
surface polls Postgres. A WebSocket added on top of polling only moves the poll
loop from the browser into the API. Build the signal first, then pick the
transport by what the client needs to send back. Today the client sends
nothing back on these surfaces, so SSE is enough (moderate-high confidence).

AsyncAPI fits as documentation and contract validation. It is a poor codegen
source for this repo: orval, the generator in use, reads OpenAPI only, and
Modelina would produce a second set of types for the same classes. One set of
`@nestjs/swagger` DTO classes can feed both documents.

## Current state

| Surface                           | Mechanism                                                             | Location                                             |
| --------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| Chat send and resume stream       | AI SDK UI-message SSE, server polls `run_events` every 200 ms         | `apps/api/src/runs/run-stream-bridge.ts` (`POLL_MS`) |
| `GET /api/v1/runs/:id/events`     | SSE with `Last-Event-ID` cursor, server polls every 500 ms, 5 min cap | `apps/api/src/runs/runs.controller.ts`               |
| Background run completion         | React Query `refetchInterval` 4 s per tracked run, also when hidden   | `apps/web/contexts/active-runs-context.tsx`          |
| Chat list, titles, pins, projects | invalidated only by local mutations and run completion                | `use-chat-engine.ts`, `active-runs-context.tsx`      |
| Mid-flight cancel across procs    | absent; API sets `cancel_requested_at`, a busy worker never sees it   | #207[^issue-207], `docs/product/operator/scaling.md` |

Writers coalesce model deltas every 150 ms (`DEFAULT_DELTA_FLUSH_MS`), so one
active Run commits about seven `run_events` transactions per second.
Issue #118[^issue-118] already asks for LISTEN/NOTIFY on the run path; its body
says 200 ms, which matches the bridge but not the 500 ms controller poll.

Gaps that polling hides: a title generated after the first turn, a second tab
or device renaming or pinning a chat, and a Run started on another device all
appear only on the next local mutation or focus refetch.

## Decisions

### D1 Signal: `NOTIFY` with pointer payloads, emitted by triggers

`NOTIFY` issued inside a transaction is delivered only at commit, and not at
all on rollback[^pg-notify], so a listener never sees a phantom change. That is
the property an outbox would otherwise buy. Duplicate notifications with the
same channel and payload inside one transaction are folded into one, which
coalesces bursts for free.

Payloads are pointers, never records:

```json
{
  "k": "run_event",
  "owner": "<owner_user_id>",
  "chat": "<id>",
  "run": "<id>",
  "seq": 812
}
```

Three reasons. The payload cap is 8000 bytes. Channels are database-global and
outside RLS: any session of the application role can `LISTEN` to any channel,
so a payload is visible to every process, not just the owner's. And the client
must refetch through RLS anyway, so a record copy in the payload would be a
second, unaudited read path.

Emit from `AFTER` triggers on `run_events`, `runs` (status), `chats`, `pins`
and `projects`, not from repository code. A trigger covers every writer: the
API, the worker, migrations and future paths. Repository-level emission misses
the next writer someone adds. The triggers are a manual SQL step and follow the
SQL-comment contract in `apps/api/src/db/AGENTS.md`.

The owner comes from the database, never from a caller: `chats.owner_user_id`
and `runs.user_id` directly, and `run_events` (which carries only `run_id`)
through a lookup on `runs`. That lookup is the trigger's normal path, so a
missing Run yields no notification rather than an ownerless one.

Known cost, moderate confidence and not stated on the `NOTIFY` page: the
implementation serializes the commits of notifying transactions while it
queues their notifications. The documented failure mode is a full queue, which
makes notifying transactions fail at commit[^pg-notify]. At seven
commits per second per active Run this is irrelevant for a self-hosted
installation. It becomes the first bottleneck at hundreds of concurrent Runs;
`scaling.md` already names Redis pub/sub as the swap seam (moderate
confidence on the threshold, unmeasured here).

### D2 Hub: one listener connection per API process

postgres.js `sql.listen(channel, fn)` holds a dedicated connection outside the
pool, reconnects with backoff, and calls an optional `onlisten` callback on
the initial connect and on every reconnect[^postgresjs-listen]. Notifications
sent while it was disconnected are lost, so the hub broadcasts a `resync`
message to its clients from that callback. Clients answer `resync`
by invalidating every live query.

The hub keeps two in-memory maps: owner id to open feed connections, and run
id to waiting run-event streams. Every API replica listens, so no sticky
routing is needed and replicas stay stateless as `scaling.md` requires.
Workers listen too once #207[^issue-207] ships; the same channel carries
cancel requests.

### D3 Feed content: invalidation messages, not record deltas

Send `chat.changed`, `run.changed`, `pin.changed`, `project.changed`, `resync`.
The client maps each to `queryClient.invalidateQueries` on the existing
`chatQueryKeys`, `pinQueryKeys` and `activeRunsQueryKeys`. React Query
refetches through the authenticated, RLS-scoped endpoints that already exist.

This needs no durable change log, no per-client cursor and no merge logic. A
missed message costs one stale view until the next `resync` or focus refetch.
Record deltas would require an outbox with sequence numbers, replay, and a
client-side patch path for every entity. That cost is justified only once a
view must update without a refetch round trip, such as collaborative editing.

Token streaming stays on the per-Run AI SDK stream. `DefaultChatTransport`
consumes its own SSE protocol, and multiplexing tokens into the feed would
mean writing a custom transport.

### D4 Run-event streams: wake on notify, keep the cursor

Both pollers keep their cursor logic and replace the fixed sleep with
"wait for a hub wake-up or a fallback timeout, then read past the cursor".
The read path is unchanged, so replay and resume semantics stay as specified;
only latency and idle query load drop. The fallback timeout (seconds, not
milliseconds) covers a missed notification.

### D5 Transport: SSE first, WebSocket when the client must send

| Concern                   | SSE                                                      | WebSocket                                                                                       |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Auth                      | same cookie or bearer path, `SessionAuthGuard` unchanged | browser cannot set `Authorization` on upgrade; cookie or one-time ticket only                   |
| Cross-site                | covered by existing CORS                                 | no CORS on upgrade; must check `Origin` or accept cross-site WebSocket hijacking                |
| Resume                    | `Last-Event-ID` built in, already implemented            | application protocol required                                                                   |
| Client to server          | none; use HTTP                                           | native                                                                                          |
| Infrastructure            | plain HTTP, existing Express adapter                     | `@nestjs/websockets` + `@nestjs/platform-ws` pinned to `^11` (latest is 12, needs Nest core 12) |
| HTTP/1.1 connection limit | 6 per origin per browser, shared across tabs             | one socket per tab                                                                              |

The connection limit is the strongest argument for WebSocket: on HTTP/1.1,
three tabs each holding a feed and a Run stream exhaust it and block ordinary
requests. HTTP/2 between browser and API removes the limit; a single shared
feed per browser through a `SharedWorker` or `BroadcastChannel` leader is the
other remedy. The deployment's HTTP version must be stated in the proposal.

WebSocket also earns its place when the browser sends frequent messages: presence,
typing indicators, collaborative editing, or interactive tool approvals with
sub-second round trips. Cancel does not qualify; it is an HTTP `POST`, and the
cross-process half of it is #207[^issue-207], which is server-side.

If Leo picks WebSocket anyway, the binding rules are: use `ws`, not Socket.IO
(Socket.IO adds its own framing, which AsyncAPI and plain clients then have to
model); authenticate in the upgrade handler from the session cookie through the
same session service, reject before `101`; allowlist `Origin`; bind the socket
to the owner id at upgrade and never accept a subscription that names an owner.

### D6 Contracts: one DTO source, two documents

Author each feed message as a class with `@ApiProperty`, with a `type`
discriminator, and a union schema built with `@ApiExtraModels` and
`getSchemaPath`. Then:

- **Client types: OpenAPI and orval.** Register the message classes as extra
  models in `generate-openapi.ts` and reference the union from the feed
  operation's `text/event-stream` response schema; `streamRunEvents` declares
  `{ type: string }` today. Orval generates the union type. Unverified: the
  `orval.config.ts` filter excludes the `streaming` tag, and whether that also
  drops schemas reachable only from excluded operations needs a spike. If it
  does, reference the union from an included operation or set orval's schema
  filter explicitly.
- **Documentation: AsyncAPI 3.0.** `nestjs-asyncapi` 2.0.1 emits AsyncAPI
  `3.0.0`, discovers `@Controller` classes, reads DTOs through `@ApiProperty`,
  and accepts `@nestjs/swagger` `^11` and Nest `^11`[^nestjs-asyncapi]. It
  bundles `@asyncapi/generator`, so keep it a dev dependency imported only by a
  `generate-asyncapi.ts` script that mirrors `generate-openapi.ts`, and commit
  `asyncapi.json` beside `openapi.json`.
- **SSE binding.** No SSE binding exists in the AsyncAPI bindings
  repository[^asyncapi-bindings]. Model the feed as an `http` server with a
  `GET` channel and `text/event-stream` content type. For WebSocket, the `ws`
  binding is official.
- **Fallback without the library.** Hand-author `asyncapi.yaml` and point
  message payloads at `openapi.json#/components/schemas/...` with
  `schemaFormat: application/vnd.oai.openapi;version=3.0.0`[^asyncapi-3-schema-format];
  `@nestjs/swagger` emits OpenAPI `3.0.0`, whose `nullable` is not JSON Schema,
  so the format declaration is required for the references to validate.
- **Contract test.** Parse the generated document with `@asyncapi/parser` in a
  test next to `openapi.contract.test.ts`, and assert that every message
  `type` in the union appears in the document.

Skip Modelina and the AsyncAPI generator templates for client code: they would
produce a second set of types for the same classes orval already covers.

## Security

Threats the design must state in its proposal:

- **Cross-tenant fan-out.** The hub routes by the owner id in the payload. The
  trigger reads it from the row or its Run (D1), not from a caller. Negative
  test: owner B's feed receives nothing when owner A's chat, run, pin or
  project changes.
- **Content leakage through notifications.** Pointers only; no titles, message
  text, tool output or paths. A test asserts the payload key set.
- **Unresolvable owner.** A notification whose owner cannot be determined, for
  example a `run_events` row whose Run was deleted, is dropped, not
  broadcast.
- **Public chats.** `chats` has a `visibility = 'public'` read path for
  unauthenticated viewers. The feed requires a session, so public viewers keep
  their current refresh behavior. Sharing a live feed with them is a separate
  decision.
- **Future shared ownership.** Owner-id routing assumes one reader per record.
  Household or organization sharing will need subscriber resolution through an
  access check, not a payload field.

## Prioritized plan

1. **A1 Signal and hub.** Triggers plus the per-process listener, with the
   isolation and payload-shape tests. No client change. Highest leverage: it
   unblocks every later item, including #207[^issue-207].
2. **A2 Wake the two run-event pollers.** Closes #118[^issue-118]; token
   latency drops by up to the poll interval and idle query load disappears.
3. **A3 Owner feed over SSE with invalidation DTOs.** Retires the 4 s
   `refetchInterval` loop in `active-runs-context.tsx` (keep it only while the
   feed is disconnected) and makes titles, pins and cross-device changes live.
   Needs an issue and an OpenSpec proposal; it adds an owner-visible contract.
4. **A4 AsyncAPI generation and contract test.** Lands with A3, from the same
   DTO classes.
5. **A5 WebSocket.** Only when a client-to-server real-time need is approved.
   The DTOs, hub and AsyncAPI document carry over unchanged; only the gateway
   and the binding change.

[^issue-118]: <https://github.com/leon0399/llame/issues/118>

[^issue-207]: <https://github.com/leon0399/llame/issues/207>

[^pg-notify]: PostgreSQL 17 `NOTIFY`: delivery at commit, commit-order delivery across transactions, duplicate folding within a transaction, the 8000-byte payload limit, and failure at commit when the queue is full. <https://www.postgresql.org/docs/17/sql-notify.html>

[^postgresjs-listen]: postgres.js 3.4.7 README, "Listen & notify": dedicated connection, backoff reconnect, `onlisten` callback on connect and reconnect. <https://github.com/porsager/postgres/tree/v3.4.7#listen--notify>

[^nestjs-asyncapi]: Inspected from the published 2.0.1 tarball: `asyncapi: '3.0.0'` in `dist/lib/asyncapi-document.builder.js`; peers and controller discovery from its README. <https://www.npmjs.com/package/nestjs-asyncapi/v/2.0.1>

[^asyncapi-bindings]: <https://github.com/asyncapi/bindings>

[^asyncapi-3-schema-format]: <https://www.asyncapi.com/docs/reference/specification/v3.0.0#multiFormatSchemaObject>
