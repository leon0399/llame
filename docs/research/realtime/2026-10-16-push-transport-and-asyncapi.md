---
type: Research
title: "Server-to-client push for record changes: signal, transport and AsyncAPI contracts"
description: "Separates the missing change signal from the transport choice, turns Postgres NOTIFY pointers into owner-scoped WebSocket messages carrying the HTTP API's own records, and makes a hand-authored AsyncAPI 3.1 document the protocol source from which server and client validators are generated."
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
  - id: json-schema-to-zod
    resource: "https://www.npmjs.com/package/json-schema-to-zod/v/2.8.1"
    title: "json-schema-to-zod 2.8.1"
---

# Server-to-client push for record changes

## Finding

The transport is the cheap part. llame has no change signal: every live
surface polls Postgres. A WebSocket added on top of polling only moves the poll
loop from the browser into the API. Build the signal first, then pick the
transport. Both SSE and WebSocket carry the result; WebSocket is the chosen
transport (D5).

The protocol is defined design-first: a hand-authored AsyncAPI 3.0 document
is the source, and the API's and web client's zod validators and types are
generated from it. Code-first generation, the OpenAPI pattern in this repo,
has no fitting Nest tool for WebSocket messages (D6).

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

### D3 Feed content: records in the HTTP API's shape

Each message carries the changed record exactly as the matching HTTP endpoint
returns it: `chat.upserted` with the chat as `GET /api/v1/chats` lists it,
`project.upserted`, `run.updated`, and `pins.replaced` with the whole pin list,
plus `chat.deleted`, `project.deleted` and `resync`. Clients write the record
into their caches instead of refetching, so one change costs one database read
per API process rather than one refetch per open tab.

The NOTIFY payload stays a pointer. The hub reads the record as its owner
through the same repositories and response mappers as the HTTP controllers,
so row-level security applies to the read. Reads run in notification order
per owner; a notification for a record whose read has not started is merged
into that read, which then sees the latest committed state. The hub reads
nothing for an owner without open connections, and a failed read sends
`resync`.

Run progress is the exception: `run.progress` carries only a phase and a step,
folded from run event types with no read, because run events arrive several
times a second while a model streams.

Client-side, a record replaces its cached copy in every list whose filters it
matches, is inserted where it newly matches, and is removed where it no
longer does. A list whose membership depends on pin state the client does not
hold is refetched instead, as is every pin-filtered list after the pin set
changes. That is one refetch where client-side filtering could be wrong.

There is no durable change log or replay. A reconnect, or `resync` after the
hub's listener reconnects, refetches what the client shows.

Token streaming stays on the per-Run AI SDK stream. `DefaultChatTransport`
consumes its own SSE protocol, and multiplexing tokens into this feed would
mean writing a custom transport.

### D4 Run-event streams: wake on notify, keep the cursor

Both pollers keep their cursor logic and replace the fixed sleep with
"wait for a hub wake-up or a fallback timeout, then read past the cursor".
The read path is unchanged, so replay and resume semantics stay as specified;
only latency and idle query load drop. The fallback timeout (seconds, not
milliseconds) covers a missed notification.

### D5 Transport: WebSocket

| Concern                   | SSE                                                      | WebSocket                                                                                       |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Auth                      | same cookie or bearer path, `SessionAuthGuard` unchanged | browser cannot set `Authorization` on upgrade; cookie or one-time ticket only                   |
| Cross-site                | covered by existing CORS                                 | no CORS on upgrade; must check `Origin` or accept cross-site WebSocket hijacking                |
| Resume                    | `Last-Event-ID` built in, already implemented            | application protocol required                                                                   |
| Client to server          | none; use HTTP                                           | native                                                                                          |
| Infrastructure            | plain HTTP, existing Express adapter                     | `@nestjs/websockets` + `@nestjs/platform-ws` pinned to `^11` (latest is 12, needs Nest core 12) |
| HTTP/1.1 connection limit | 6 per origin per browser, shared across tabs             | one socket per tab                                                                              |

The connection limit favors WebSocket: on HTTP/1.1, three tabs each holding a
feed and a Run stream exhaust it and block ordinary requests. WebSocket also
leaves room for later client-to-server traffic such as presence or interactive
approvals. Cancel does not need it; it is an HTTP `POST`, and the
cross-process half is #207[^issue-207].

Binding rules for the WebSocket: use `ws`, not Socket.IO, whose framing
AsyncAPI and plain clients would then have to model; authenticate in the
upgrade handler from the session cookie or bearer token through the same
session service and reject before `101`; allowlist `Origin` against the CORS
origins; bind the socket to the owner id at upgrade and accept no subscription
that names an owner. Cookie authentication assumes the web and API origins are
same-site; a cross-site deployment needs a short-lived upgrade ticket.

### D6 Contracts: AsyncAPI document first, records from OpenAPI

`apps/api/asyncapi.yaml` (AsyncAPI 3.1) is the protocol's source of truth: one
`ws` server, one channel, one `send` operation, one message per type, the
security schemes, and the reconnect semantics in prose. Message payloads are
OpenAPI 3.0 multi-format schemas whose record fields `$ref` the component
schemas in `openapi.json`, so a socket record and an HTTP record share one
definition. The document therefore depends on the generated `openapi.json`,
and the API build generates the live protocol after it.

A repository script validates the document with the official AsyncAPI
parser and its OpenAPI schema parser, then emits one named zod schema per
referenced component through `json-schema-to-zod`[^json-schema-to-zod],
turning `oneOf` with a `discriminator` into a discriminated union. It rejects
constructs it cannot translate faithfully rather than degrading them to
`z.any()`. The API and the web client each commit a generated copy.

Redocly validates AsyncAPI structure but ignores a payload's `schemaFormat`
and rejects OpenAPI's `nullable`, so the official parser is the AsyncAPI
gate; Redocly keeps linting `openapi.json`.

Code-first generation was rejected for this protocol:

- `nestjs-asyncapi` 2.0.1 emits AsyncAPI `3.0.0` from `@nestjs/swagger`
  DTOs[^nestjs-asyncapi], but types bindings only for Kafka and AMQP and
  bundles `@asyncapi/generator` into anything that imports its decorators.
- No controller emits these messages; the hub assembles them from records.
  Code-first would add DTO classes only to feed a generator.
- Design-first gives the server compile-time types and runtime validation as
  well: the hub validates every outgoing message against the generated schema
  and drops one the document does not describe.

No SSE binding exists in the AsyncAPI bindings repository[^asyncapi-bindings];
with WebSocket the official `ws` binding applies. Modelina generates types in
many languages but no runtime validators, so it serves external consumers of
the same document rather than these two clients.

Drift gates match the OpenAPI ones:

- `pnpm lint:asyncapi` validates the document with the official parser, in
  `pnpm lint` and lefthook.
- `generate:api-schema` and `generate:web-client` regenerate both copies, and
  CI fails on any diff.
- A script test renders the document per target and compares it with each
  committed copy.
- An API contract test sends every message type, built from the real response
  DTOs, through the hub's serialization and validation, and checks that the
  serialized DTO types are assignable to the generated record types.

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
3. **A3 Owner feed over WebSocket with records.** Retires the 4 s
   `refetchInterval` loop in `active-runs-context.tsx` (kept only while the
   socket is disconnected) and makes titles, pins and cross-device changes
   live. Needs an issue and an OpenSpec proposal; it adds an owner-visible
   contract.
4. **A4 AsyncAPI document and generated validators.** Lands with A3; every
   message type exists in the document before either side uses it.
5. **A5 Channel subscriptions.** When chats become shared across owners,
   replace owner routing with per-channel authorization, the role private
   channels play in Laravel Echo.

[^issue-118]: <https://github.com/leon0399/llame/issues/118>

[^issue-207]: <https://github.com/leon0399/llame/issues/207>

[^pg-notify]: PostgreSQL 17 `NOTIFY`: delivery at commit, commit-order delivery across transactions, duplicate folding within a transaction, the 8000-byte payload limit, and failure at commit when the queue is full. <https://www.postgresql.org/docs/17/sql-notify.html>

[^postgresjs-listen]: postgres.js 3.4.7 README, "Listen & notify": dedicated connection, backoff reconnect, `onlisten` callback on connect and reconnect. <https://github.com/porsager/postgres/tree/v3.4.7#listen--notify>

[^nestjs-asyncapi]: Inspected from the published 2.0.1 tarball: `asyncapi: '3.0.0'` in `dist/lib/asyncapi-document.builder.js`; binding types limited to Kafka and AMQP in `dist/lib/interface`. <https://www.npmjs.com/package/nestjs-asyncapi/v/2.0.1>

[^asyncapi-bindings]: <https://github.com/asyncapi/bindings>

[^json-schema-to-zod]: Emits zod v4 source by default; no runtime dependencies. <https://www.npmjs.com/package/json-schema-to-zod/v/2.8.1>
