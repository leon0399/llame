## Why

A Chat Completions stream event the adapter cannot parse fails the run with
the SDK's parse error, and that message quotes the whole event. One event of
response body, unbounded in size, therefore reaches the owner's run failure,
the persisted run, its run events, and the log line, which the failure
contract otherwise keeps free of raw response bytes (#908). The same boundary
has two sibling defects: an error envelope delivered inside the stream reaches
the run as `[object Object]`, although the shipped Go contract promises the
gateway's parsed message; and a refused redirect reaches the owner as the bare
status text (`Found`), which says nothing about what happened.

Reproduced on 2026-09-23 against the installed adapters
(`@ai-sdk/openai-compatible@2.0.75`, `ai@6.0.256`, `@ai-sdk/provider@3.0.16`)
with a stubbed transport:

| Stream event                                  | Error delivered to the run's `onError` | Recorded message                                                                          |
| --------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| not JSON                                      | `JSONParseError`                       | `JSON parsing failed: Text: <the whole event>.` plus the parser's error                   |
| JSON that does not match the chunk shape      | `TypeValidationError`                  | `Type validation failed: Value: <the whole event as JSON>.` plus the full validation dump |
| `{"error":{"message":"Upstream overloaded"}}` | a plain object, not an `Error`         | `[object Object]` (run loop's `String(error)`)                                            |

Node's `fetch` under `redirect: 'manual'` returns the real 3xx response
(checked against a local server: `status 302`, `statusText "Found"`), so the
issue comment's description of an opaque status-0 response does not apply on
the server; the owner sees `Found`, not an empty message.

## What Changes

- Every request on the Chat Completions wire (`openai-completions` and
  `opencode-go` entries) fails under one stated failure contract, owned by
  `provider-api-selection` instead of being described only inside the Go
  capability:
  - a stream event that is not JSON, does not match the wire's chunk shape, or
    carries an error value without a string message fails the run with one
    fixed message that contains none of the event's content;
  - an error envelope delivered inside the stream fails the run with the
    envelope's parsed message, the same message an HTTP failure carrying that
    envelope already produces;
  - a redirect response (301, 302, 303, 307, 308) that reaches the client,
    including one answering an SDK retry, fails the run with a fixed message
    naming the status code and no `Location`; in practice that is an
    `opencode-go` entry, whose transport refuses redirects;
  - HTTP failures with the envelope keep its parsed message, HTTP failures
    without it keep the status text, retried failures keep the SDK's retry
    summary, and transport failures keep their message, exactly as today.
- The error the run receives for an unparseable event is a new error carrying
  no reference to the event: no quoted text, no `cause`, no retained chunk. The
  issue's suggestion to keep the raw chunk on the error for debugging is not
  adopted (design D4).
- The Go capability's failure requirement drops the sentence that accepts the
  quoting as an exception and points to the wire's contract; every Go-specific
  rule it states (no llame-owned classification of the gateway's messages, no
  quota ledger, no fallback, the runbook's accepted shapes) is unchanged.
- The Go operator runbook's failure paragraph and the changelog follow.

No configuration, API, or schema change. No new dependency. Nothing an owner or
operator relies on is removed: the only removed output is event bytes inside a
failure message.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `provider-api-selection`: adds one requirement, "Chat Completions failures
  reach the run as bounded messages", stating the wire's failure contract for
  every entry that uses it.
- `opencode-go-provider`: "Upstream failures are mirrored under the existing
  contract" references that requirement instead of restating it, and no longer
  accepts a quoted stream event as an exception. Its scenarios are preserved.

## Assumptions and decisions for review

- The redirect message (issue comment, 2026-09-21) is in scope. The request
  approving this change named O1 (the OpenSpec route for #908) and F2 (the
  in-stream envelope); the redirect is part of #908 as filed, so it is
  included. Dropping it removes one mapping, one scenario, and one test.
- Exact owner-facing texts are a design decision (D5) and open to review; the
  spec fixes what they must and must not carry, not their wording.
- Structured generation (title generation, the only `generateObject` caller)
  is out of scope: its failures do not pass through the stream event parser,
  and the title service owns its own fallback.

## Non-goals

- The Responses wire's in-stream error events. `@ai-sdk/openai@3.0.97` also
  delivers a plain object for them (`dist/index.mjs:6978`), so a plain
  `openai-responses` entry very likely shows `[object Object]` too. That path
  is unverified here and belongs in its own issue.
- Bounding the length of a parsed envelope message, or of the status text.
  Both are endpoint-authored diagnostics the contract already forwards.
- Transport, timeout, and cancellation failures, whose messages are authored
  by llame, the platform, or the SDK and do not change.
- A tool-call delta the adapter rejects inside its stream transform
  (`InvalidResponseDataError`, `@ai-sdk/openai-compatible` `dist/index.mjs:803-807`).
  It never reaches `onError`, its message is fixed, and the delta it carries on
  `.data` reaches no run surface today.
- A generic run-loop sanitizer. The run loop is transport-neutral and cannot
  tell SDK-authored text from upstream bytes (design D1).
- Two adjacent defects observed in code while scoping this change and left
  for their own issues, because each spans every wire:
  - A stream error does not reject the result's `text` (verified with the
    stubbed transport: it resolves with the text received before the bad
    event, and `finishReason` is `error`). Compaction reads only `text`,
    `toolCalls`, and `finishReason === 'tool-calls'`
    (`apps/api/src/compaction/compaction.service.ts:584-596`), so a stream
    that fails mid-summary appears to yield a truncated summary. Not
    exercised end to end here.
  - Callers that pass no `onError` (compaction, the title service's text
    path) get the AI SDK's default, `console.error(error)`
    (`ai@6.0.256` `dist/index.mjs:6987-6989`), which prints the whole error
    object. For an HTTP failure that object carries the request body llame
    sent (`requestBodyValues`) and the response body and headers. This change
    stops the default from printing a stream event on the Chat Completions
    wire (design D2) and does not change what it prints for any other error.
    The shipped Go requirement already states that failure bodies and headers
    stay out of logs; this change keeps that sentence as written, and the
    follow-up issue owns making it true on handler-less paths.

## Delivery

One PR, by Leo's named exception (2026-09-23) to the proposal / implementation
/ finalize stack: the proposal is reviewed locally before implementation, then
implementation, spec synchronization, and archive movement land on the same
branch (`issue-908`) and publish together. That PR closes #908. Estimated
authored size about 800 lines including this change's artifacts, within the
review budget.

## Impact

- `apps/api/src/models/openai-completions-model-client.ts`: one error-bounding
  function applied to every error the streaming request reports.
- `apps/api/src/models/openai-completions-model-client.test.ts`,
  `apps/api/src/models/opencode-go-model-client.test.ts` (the test that pins
  the quoted event is inverted), and one run-level test in
  `apps/api/src/runs/run-execution.service.test.ts`.
- `docs/opencode-go.md` failure paragraph and `CHANGELOG.md`.
- Canonical specs at finalize: `provider-api-selection` and
  `opencode-go-provider`.
