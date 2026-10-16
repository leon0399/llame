---
paths:
  # One brace-expanded entry: multi-entry lists did not match before Claude
  # Code 2.1.84 (https://github.com/anthropics/claude-code/issues/16853).
  - "{apps/api/asyncapi.yaml,apps/api/src/live/generated/**,apps/web/lib/api/live-generated/**,scripts/generate-live-protocol*.mjs}"
---

# AsyncAPI live protocol

`apps/api/asyncapi.yaml` (AsyncAPI 3.1) defines the owner-scoped
`/api/v1/live` WebSocket. It is design-first: the document is the source of
truth, and the API's and web client's message validators and types are
generated from it. OpenAPI stays code-first; the two meet at the record
schemas.

## Rules

- Change the document first, then regenerate. Never hand-edit
  `apps/api/src/live/generated/live-protocol.ts` or
  `apps/web/lib/api/live-generated/live-protocol.ts`.
- Records are never redefined here. A message that carries a record `$ref`s
  `./openapi.json#/components/schemas/<Name>`, so a socket record is exactly
  what the HTTP endpoint returns. To change a record, change the API response
  DTO, rebuild `openapi.json`, and regenerate.
- Message payloads live under `components.schemas` as multi-format schemas
  (`schemaFormat: application/vnd.oai.openapi;version=3.0.0`) and messages
  reference them. OpenAPI 3.0 has no `const`: discriminate with a
  single-value `enum`.
- Each message's `name` equals its payload's `type` enum value, every payload
  is an object with `additionalProperties: false`, and `required` lists every
  field. The generator rejects a mismatch.
- Messages never carry content the owner could not read over HTTP, and the
  NOTIFY payloads behind them never carry content at all: pointers only.
- The generator supports only the schema subset the protocol uses
  (`type`, `enum`, `format`, `minimum`, `maxLength`, `nullable`,
  `description`, `properties`, `required`, `additionalProperties`, `items`,
  `$ref`, and `oneOf` with a `discriminator` over `$ref` members). It fails on
  anything else rather than emitting `z.any()`. Extend
  `scripts/generate-live-protocol.mjs` and its tests instead of reshaping a
  schema to dodge the check.

## Adding or changing a message

1. Edit `apps/api/asyncapi.yaml`: payload schema, message, channel entry, and
   the `sendLiveUpdate` operation's message list.
2. `pnpm lint:asyncapi` (the official AsyncAPI parser with its OpenAPI schema
   parser).
3. `pnpm generate:api-client`, which builds the API (OpenAPI, then the live
   protocol) and regenerates the web client; commit both generated copies.
4. Server: produce the message in `apps/api/src/live/live-messages.ts`
   (`recordJobFor` or the run tracker). Read records as their owner through
   `LiveRecordLoader`, reusing the HTTP repositories and response mappers.
5. Add the message to `apps/api/src/live/live-protocol.contract.test.ts`,
   built from the real response DTOs.
6. Web: handle it in `apps/web/lib/services/live/apply-live-message.ts`, or
   route it to subscribers in `live-updates-context.tsx`. The web parser
   ignores unknown types, so the server can ship a message before the client
   uses it.

## Gates

- `pnpm lint:asyncapi` runs in `pnpm lint` and lefthook. Do not lint the
  document with Redocly: it ignores `schemaFormat` and rejects OpenAPI's
  `nullable`.
- CI regenerates both copies and fails on any diff;
  `scripts/generate-live-protocol.test.mjs` does the same comparison locally.
- The hub validates every outgoing message against the generated schema and
  drops and logs one the document does not describe. A dropped-message error
  in the logs means the server and the document disagree; fix the document or
  the producer, never the check.
