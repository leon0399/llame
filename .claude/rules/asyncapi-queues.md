---
paths:
  # One brace-expanded entry: multi-entry lists did not match before Claude
  # Code 2.1.84 (https://github.com/anthropics/claude-code/issues/16853).
  - "{apps/api/asyncapi.queues.yaml,apps/api/src/queue/**,apps/api/src/runs/run-queues.ts,apps/api/src/search/reindex-queues.ts,apps/api/src/auth/session-cleanup.service.ts,scripts/generate-asyncapi-module*.mjs}"
---

# AsyncAPI job queues

`apps/api/asyncapi.queues.yaml` (AsyncAPI 3.1) defines the pg-boss job
queues: one channel per queue, whose `address` is the pg-boss queue name, a
`send` and a `receive` operation per channel, and one message whose payload is
the job's `data`. It is design-first: the document is the source of truth,
and `apps/api/src/queue/generated/queue-protocol.ts` exports one
`<channel>Channel` constant per channel (address, static options, payload
schema) generated from it. The WebSocket protocol has its own document and
rules (`asyncapi-websocket.md`).

## Rules

- Change the document first, then regenerate with
  `pnpm --filter api generate:queue-protocol`. Never hand-edit the generated
  module.
- A queue definition takes its `name` and static `options` from its generated
  channel constant, and its `parse` from the constant's `payload`. The cron
  channels (`search-sweep`, `sessions.cleanup`) are the exception: pg-boss
  re-sends the schedule's own data on every tick, which is `null` when the
  schedule registers none, and their consumers read nothing, so their
  definitions do not validate the tick. `CronTick` admits `null` for the same
  reason.
- Options that come from operator configuration (the runs heartbeat window
  and job expiry) are applied in code and described in the channel
  `description`, never in `x-llame-queue`.
- `x-llame-queue` holds only `QueueOptions` keys pg-boss applies per queue:
  `policy`, `retryLimit`, `retryDelay`, `retryBackoff`, `deadLetter`.
  Generation rejects any other key. No AsyncAPI binding exists for pg-boss;
  do not borrow another protocol's.
- `policy` is applied only when pg-boss creates a queue and cannot change
  afterwards; `ensureQueue` re-applies only the retry and dead-letter
  options. Changing a deployed queue's `policy` means moving it to a new
  address, like a breaking payload change.
- Payloads use the AsyncAPI default schema format (JSON Schema), not the
  OpenAPI `schemaFormat`: the parser rejects a `$ref` between two multi-format
  components, and this document references nothing in `openapi.json`.
- Payload objects never set `additionalProperties: false`. A queued, retrying
  or dead-lettered job can be read by another deploy, and consumers must
  ignore fields they do not know. Adding a required field, removing a field or
  changing a type is a breaking change: move the queue to a new address.
- Every message has a `summary` and an `examples` entry on the message object.
- The pg-boss envelope (job id, singleton key, retry state) is not part of the
  payload and is not described here; a channel `description` names the
  singleton key a producer sets.

## Gates

- `pnpm lint:asyncapi` validates both documents with the official parser.
- `scripts/generate-asyncapi-module.test.mjs` fails when the committed module
  is stale, and CI regenerates it during the API build and fails on any diff.
