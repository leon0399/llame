## Context

See proposal.md for the defect and its reproduction. The relevant substrate,
inspected at the worktree's base commit `6f4214dd` with the installed
packages:

- `createOpenAICompletionsModelClient`
  (`apps/api/src/models/openai-completions-model-client.ts:287-324`) passes the
  caller's `onError` straight to `streamText` (`:244`). The Go client composes
  over it (`opencode-go-model-client.ts`), adding the redirect-rejecting
  `fetch` from the Codex module.
- `@ai-sdk/openai-compatible@2.0.75` parses each stream event with the chunk
  schema `z.union([chunkBaseSchema, errorSchema])` (`dist/index.mjs:1066`). A
  failed parse enqueues `{ type: 'error', error: chunk.error }` (`:681-683`),
  which is a `JSONParseError` (event not JSON) or a `TypeValidationError` (JSON
  matching neither branch). A parsed event with an `error` key enqueues
  `{ type: 'error', error: chunk.value.error }` (`:687-692`). That value is
  validated to carry a string `message` (`openaiCompatibleErrorDataSchema`,
  `:30-32`) only when the event matched the envelope branch. `chunkBaseSchema`
  is a `looseObject` requiring only `choices` (`:1030-1065`), so an event with
  both `choices` and `error` passes `error` through unvalidated: the review
  round's probe delivered a bare string and a message-less object this way.
- The adapter also throws `InvalidResponseDataError` inside its transform for a
  tool-call delta without an `id` (`:803-807`, `:825-829`). That error never
  reaches `onError`; it rejects the result's `text` with a fixed message and
  the delta on `.data`. It is out of scope (proposal, non-goals).
- `@ai-sdk/provider@3.0.16` (the copy the adapter resolves) builds the two
  parse errors' messages from the whole event: `JSON parsing failed: Text:
${text}` (`dist/index.mjs:172`) and `${prefix}: Value:
${JSON.stringify(value)}` (`:307`).
- `ai@6.0.256` `streamText` delivers every error part to `onError` and
  otherwise resolves the result: verified with a stubbed transport, a bad event
  after some text leaves `text` resolved with that text and `finishReason`
  `error`. A caller that passes no `onError` gets the default
  `({ error }) => console.error(error)` (`dist/index.mjs:6987-6989`).
- `RunExecutionService`'s `onError` logs `error.stack` for an `Error` and
  `String(error)` otherwise (`run-execution.service.ts:1302-1305`), and records
  the same `error.message` / `String(error)` as the run payload message, the
  persisted error, and the terminal event (`:1337-1342`, `:1372-1382`).
  Compaction (`compaction.service.ts:575-583`) and the title service's text
  path (`title.service.ts:140`) pass no `onError`.
- Prior art in this repository: the Responses client's `sanitizeError` config,
  used by the Codex transport (`openai-model-client.ts:423-424`, `:565-572`;
  `openai-codex-model-client.ts:68`), and `sanitizeAnthropicError`
  (`anthropic-model-client.ts:300-330`), both applied at the client's
  `onError`. The Anthropic client bounds every upstream failure; the Chat
  Completions wire's shipped contract keeps the endpoint's parsed message
  (`openspec/specs/opencode-go-provider/spec.md:170-191`), so this design
  bounds only what the endpoint did not author as a message.

## Goals / Non-Goals

**Goals:** the classes in the `provider-api-selection` delta, on both the
run's handler and the handler-less callers, with none of an event's content on
any bounded error the client reports.

**Non-Goals:** everything the proposal lists, plus any change to the
Responses or Messages clients, to `awaitSettlementAfter`, or to the run loop.

## Decisions

### D1: Bound at the Chat Completions client

The client module is the only place that knows which errors carry endpoint
bytes the endpoint did not author as a message: it owns the adapter, the
SDK version, and the wire. Every Chat Completions entry, including
`opencode-go` through composition, inherits the bound with no Go-specific
code, which the Go requirement forbids.

Rejected:

- The run loop. It is transport-neutral and receives the same error classes
  from other wires, where the right mapping differs (the Anthropic client
  already bounds its own). A run-loop mapping would either duplicate a
  per-wire decision or bound messages the Chat Completions contract promises
  to keep.
- Patching or wrapping the adapter's stream. The mapping needs only the error
  the adapter already reports; intercepting its stream would reimplement part
  of it.

### D2: One function on the streaming request's error channel, always installed

The client installs its own `onError` on every streaming request. It maps the
reported error (D3) and hands the result to the caller's `onError` when there
is one, and otherwise to `console.error`, which is exactly the SDK default the
handler-less callers get today, now receiving the bounded error.

The stream result's settlement channel is not wrapped: the parse, envelope,
and redirect failures arrive only as error parts, which do not reject `text` or
`consumeStream` (Context). The one endpoint-derived error seen on that channel,
`InvalidResponseDataError`, carries a fixed message and is out of scope.
Structured generation is not wrapped either (proposal, non-goals).

Rejected:

- Installing the handler only when the caller supplies one, as the Anthropic
  client does (`anthropic-model-client.ts:383-386`). Compaction and the title
  text path would keep printing the raw parse error through the SDK default,
  so the logging clause would hold for runs only.
- A no-op handler for handler-less callers. It would bound the output by
  deleting the only diagnostic those paths have.

For an error D3 leaves unchanged, the handler-less path prints what it prints
today, which for an HTTP failure is the whole `APICallError` including the
request and response bodies. That is why the spec limits its logging promise
to the run's failure log line and, for handler-less callers, to classes 1 and
2; the wider default-handler exposure is the proposal's second follow-up.

### D3: Classify by SDK error identity, never by message text

The mapping, in order:

1. A redirect: `APICallError.isInstance(error)` with status 301, 302, 303, 307,
   or 308, or `RetryError.isInstance(error)` whose `lastError` is such an
   `APICallError`. A new `Error` with the fixed redirect text and that status.
   The status set is the redirect set the web-read contract already uses; a
   300 or 304 is not a redirect llame could follow and keeps its status text.
   The class is defined by status alone, so a plain `openai-completions` entry
   whose following `fetch` hands back a redirect without a usable `Location`
   reports the same text, which stays accurate: llame did not follow it. The
   Codex client reads statuses out of `RetryError.errors` the same way
   (`openai-codex-model-client.ts:59-66`).
2. `JSONParseError.isInstance(error)` or `TypeValidationError.isInstance(error)`:
   a new `Error` with the fixed unreadable-event text.
3. Any other `Error`: unchanged. This keeps the parsed envelope message and the
   status text of HTTP failures, the SDK's retry summary, and transport
   failures exactly as they are. Abort reasons never pass through this
   handler: llame's abort settlement calls the caller's `onError` directly
   (`openai-model-client.ts:248-262`), which the review round confirmed.
4. A non-`Error` record whose `message` is a string: a new `Error` with that
   message. This is the in-stream envelope (Context), and the message is the
   same parsed message an HTTP failure carrying that envelope already produces.
   Other envelope fields (`type`, `param`, `code`, `metadata`) are not copied.
5. Any other non-`Error`: a new `Error` with the fixed unreadable-event text.
   Only an unvalidated `error` value (Context) reaches the handler this way,
   and passing it through would record the endpoint's raw string or
   `[object Object]`.

`isInstance` is the SDK's cross-copy check: each error class brands its
instances with `Symbol.for('vercel.ai.error.<name>')`, so `apps/api`'s direct
`@ai-sdk/provider@3.0.15` recognizes errors built by the adapter's `3.0.16`
copy, as the Anthropic client already relies on for `APICallError`.

Rejected: matching the message prefix (`JSON parsing failed`). An SDK wording
change would silently reopen the leak, and the prefix is the SDK's, not a
contract.

### D4: The bounded error carries nothing from the event

The new `Error` has no `cause` and no extra property. The issue suggested
keeping the raw chunk on the error for debugging; that is rejected. Nothing in
llame reads such a field, and the handler-less path hands the error to
`console.error`, which prints `cause` and own properties, so a retained chunk
would reach the log it was removed from. The repository's other bounded errors
make the same choice (`openai-embedding-backend.ts:33-37`,
`sanitizeAnthropicError`).

### D5: Owner-facing texts

- Unreadable event: `Model request failed: the provider sent a stream event
that could not be read.`
- Redirect: `Model request failed: the provider answered with a redirect (HTTP
<status>), which is not followed.`

They name the provider rather than the wire because the owner chose a model,
not a wire, and an `opencode-go` entry never names Chat Completions. Neither
names the destination: the redirect target is the endpoint's choice and is kept
off every surface. Tests assert the contract (identical across events, no
canary, status code present) and not this wording.

### D6: Proof at the real seams

- Client tests drive the real client and adapter over a stubbed `fetch`, which
  is the seam the existing Go failure tests use, so an SDK upgrade that changes
  delivery or class identity fails them.
- One run-level test passes the real completions client over a stubbed `fetch`
  to `RunExecutionService.executeRun` and asserts the persisted error, the
  terminal run event payload, and the `Logger.error` arguments. That is the
  issue's acceptance, and the only test that proves the `[object Object]`
  rendering is gone from the run itself.
- The Go test that pins the quoted event is inverted in place, not deleted,
  because the Go capability keeps a scenario for it.

## Risks / Trade-offs

- [An adapter upgrade reports parse failures through a different class or
  channel, and the mapping falls through to "unchanged"] → The client and run
  tests run the real adapter, so the leak reappearing fails CI on the upgrade.
- [Operators lose the parser's detail when debugging a misbehaving endpoint] →
  Accepted. The detail was one event of response body in a durable owner
  surface; reproducing against the endpoint recovers it.
- [A parsed envelope message is endpoint-authored and unbounded in length] →
  Unchanged behavior, already accepted by the shipped contract; out of scope.
- [An in-stream envelope with extra fields] → Only `message` is copied (D3).

## Migration Plan

None. No data, configuration, or API shape changes. Runs that already failed
keep their recorded messages; no backfill is proposed because a quoted event
in an existing run is the owner's own run output and nothing re-reads it.
Rollback is a revert of the client change.

## Revision history

- v1 (2026-09-23): Initial draft.
- v2 (2026-09-23): One review round, two independent reviewers (spec
  contract; SDK behavior), every finding checked against the built adapter
  source and the Go tests. Accepted: the "exactly one of" list contradicted
  the SDK retry summary the Go tests pin, so the classes are now ordered and
  endpoint-derived only; the logging promise was overbroad for handler-less
  callers, so it covers the run's log line and, for those callers, classes 1-2;
  an `error` value on an event that also has `choices` is unvalidated
  (`dist/index.mjs:1030-1066`), so a string or message-less value is now
  bounded (D3 step 5); a redirect wrapped in `RetryError` and a redirect on a
  following client are covered by defining the class by status (D3 step 1);
  the Go scenario names the event classes instead of "cannot read", and
  malformed tool-call deltas are a non-goal; the invariance and "no byte"
  wording is now testable; a transport-failure pass-through scenario and test
  were added. No finding rejected.
