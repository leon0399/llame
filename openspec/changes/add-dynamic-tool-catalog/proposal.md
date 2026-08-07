## Why

The Run tool loop can only execute tools whose input schema is authored in code.
Its declaration path is already JSON-Schema-driven end to end — snapshots persist a
JSON Schema, and the loop builds its toolset from that — but the executor side binds
to a code-authored schema, and the snapshot rebind reconstructs a JSON Schema from
it to compare byte-for-byte. A tool whose schema is natively JSON Schema cannot
survive that comparison, so it cannot execute. Both #213 (Markdown vault tools)
and #215 (remote MCP) need it to.

Independently, an in-flight tool call is settled in neither direction when its Run
is cancelled, expires, or fails: the live stream leaves the tool rendered as running
forever, while persistence drops the call entirely, so a reload shows that it never
happened (#293, verified against the run-event translator). That is a live defect
and an audit hole.

And a round's tool activity does not survive into later turns at all. The chat UI
renders tool results, so the reader can see output the model has already lost — ask
"what was the second result?" one turn later and the model has nothing, while the
answer is on screen in front of both of them. The same information is load-bearing
inside the turn, where the loop feeds it to the next step, and discarded at the turn
boundary, which is where `partsToText` happens to run rather than anywhere the
information changed.

## What Changes

- A tool may declare its input schema as JSON Schema, in the draft-07 dialect the
  model SDK's tool-schema type declares. Both forms get the same validation, the same
  classification gate, the same allowlist gate, and the same tenant-scoped execution.
- Declaration comparison stops round-tripping a JSON Schema through the code-schema
  conversion, and is defined as canonical equality — key order is not drift, any
  content difference is.
- The shipped write-tool landmine requirement is strengthened to name the concrete
  re-execution path: the run queue retries a failed job, and a retried run that is
  still claimable re-enters the tool loop from the first step.
- Tool execution receives a cooperative cancellation signal from the trusted
  execution context.
- Every in-flight tool call settles when a Run is cancelled, expires, or fails —
  live, in persisted history, at most once per call, and distinguishably from a
  genuine tool failure. (#293)
- A round's tool observations survive into later turns, replayed in the conventional
  tool-call/tool-result representation providers expect (via the model SDK's portable
  parts), carrying the tool's identity, what it was asked, and its outcome — including
  calls that were refused, cancelled, timed out, or errored, which replay carrying that
  outcome as a well-formed result. The call/result pair is itself the trained shape, so
  an unmatched call is out-of-distribution whether or not a given provider rejects it —
  which makes the settlement guarantee a prerequisite rather than a nicety.
  Replayed results are labelled as tool output whose instruction-like text is not
  authoritative, escape-proofed, bounded, and stable once projected so the replayed
  prefix stays cacheable. Provider-native reasoning, provider metadata, credentials,
  and unrelated payloads still never replay, and compaction may clear a payload while
  keeping the call and its outcome.
- **BREAKING (internal typing):** the context builder's message type widens to the
  model SDK's, deleting three `as AiModelMessage[]` casts that existed only because a
  string-content `role: 'tool'` message cannot satisfy `ToolModelMessage`.

## Capabilities

### New Capabilities

None. This extends the existing tool loop.

### Modified Capabilities

- `tool-calling`: tool input schemas may be JSON Schema and must compare without a
  representation round-trip; cancellation reaches tool execution; termination must
  settle in-flight
  tool activity truthfully in both the live stream and history, idempotently per
  call; a round's tool observations survive into later turns as a bounded,
  untrusted-labelled, provider-neutral projection preserving outcome status; the
  write-tool landmine names queue retry as the re-execution path.

## Impact

- `apps/api/src/tools/` — tool contract, argument validation.
- `apps/api/src/runs/` — snapshot declaration comparison, tool-event emission and
  settling on the abort path, the run-event to UI-chunk translator's terminal
  handling.
- `apps/api/src/compaction/` — the AI SDK `toolCalls` boundary cast becomes a typed
  adapter.
- `apps/api/src/chats/context-builder.ts` — widening the message type to the SDK's and
  replaying tool observations; `apps/api/src/compaction/` — message construction and
  clearing replayed payloads at compaction. `models/model-client.ts` needs no change
  (already SDK-typed), nor does the token estimator (it serializes the whole array).
- `apps/web` — rendering the cancelled tool state.
- No SPEC §13.5 change: the classification vocabulary is untouched.
- No database migration (`run_events.event_type` is text, not an enum). No config
  schema change. No transport, connector configuration, permission UI, or policy
  evaluation.

Deliberately **not** here, with the decision recorded in `design.md` so the
consuming change does not re-litigate it: the dynamic id namespace and the
`tools.allowed` boot-validation split, withdraw-on-declaration-drift, tool-payload
redaction, and neutralization of externally supplied tool metadata. Each becomes
necessary only when a tool arrives from outside this codebase, which is #215. The
tool-result truncation defect is #294.

This change is authored as one specification and is expected to be implemented as a
stack of separately reviewable branches.
