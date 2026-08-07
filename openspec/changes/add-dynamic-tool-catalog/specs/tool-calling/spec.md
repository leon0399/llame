## ADDED Requirements

### Requirement: Tool input schemas may be declared as JSON Schema

A tool SHALL be able to declare its input schema directly as JSON Schema, not only in code. Both forms SHALL receive the same argument validation, the same safety classification gate, the same operator allowlist gate, and the same tenant-scoped execution — neither form SHALL be privileged or exempted.

The supported dialect SHALL be **JSON Schema draft-07**, matching the dialect the model SDK's tool-schema type declares. A declaration whose `$schema` names a different dialect SHALL be refused when its source contributes it, naming the tool and the unsupported dialect — silently validating a 2020-12 declaration under draft-07 rules would apply different semantics to keywords the author expected to be enforced. A declaration that omits `$schema` SHALL be treated as draft-07.

Comparing a bound snapshot declaration against its live tool SHALL NOT convert a schema that is already JSON Schema into another representation and back. Comparison SHALL be by **canonical equality**: two declarations are equal when their canonical forms — recursively key-sorted, with no other normalization — are identical. Key order and other insignificant serialization differences SHALL NOT count as drift; any difference in schema content SHALL. The same canonicalization SHALL be used when the snapshot is written and when it is compared, so the two can never disagree.

#### Scenario: A declaration in an unsupported dialect is refused

- **WHEN** a source contributes a tool whose input schema declares a `$schema` dialect other than the supported one
- **THEN** the tool is refused at contribution, naming the tool and the dialect, and no run advertises it

#### Scenario: Key order is not drift

- **WHEN** a bound declaration and its live tool differ only in the key order of their JSON Schema
- **THEN** they compare equal and the tool executes

#### Scenario: A changed schema is drift

- **WHEN** a live tool's schema differs from its bound declaration in any content — an added, removed, or altered constraint
- **THEN** they do not compare equal

#### Scenario: A JSON-Schema tool is advertised, validated, and executed

- **WHEN** an allowlisted tool classified `read_only` declares its input schema as JSON Schema, and the model calls it with valid arguments
- **THEN** it is advertised, its arguments are validated against that schema, and it executes through the same path as a code-authored tool

#### Scenario: Invalid arguments for a JSON-Schema tool are refused

- **WHEN** the model calls such a tool with arguments its schema rejects
- **THEN** a structured, non-fatal error result is recorded and the run continues

#### Scenario: An unchanged JSON-Schema tool rebinds without spurious drift

- **WHEN** a run binds a snapshot declaring a JSON-Schema tool and later executes it, with nothing about that tool changed
- **THEN** the declaration matches and the tool executes

#### Scenario: Tool activity from a JSON-Schema tool reconstructs from history

- **WHEN** a chat containing a completed JSON-Schema tool call is reloaded
- **THEN** the persisted parts reconstruct the same call and result presentation as a code-authored tool

### Requirement: Cooperative cancellation reaches tool execution

Tool execution SHALL receive a cancellation signal derived from both the run's termination and the effective per-call timeout, so a tool that supports cooperative cancellation can abandon work whose result can no longer be used. A tool that ignores the signal SHALL still be bounded by its existing timeout and SHALL still produce a structured result. The signal SHALL come from the trusted execution context, never from model-controlled arguments.

#### Scenario: Run cancellation reaches an executing tool

- **WHEN** a run is cancelled while a tool is executing
- **THEN** that tool's execution context observes cancellation

#### Scenario: Per-call timeout still bounds an uncooperative tool

- **WHEN** an executing tool ignores the cancellation signal
- **THEN** it is still bounded by its effective timeout and still yields a structured result

### Requirement: Termination settles in-flight tool activity

When a run terminates — cancelled, expired, or failed — every tool call that was requested but never settled SHALL be settled before the run reaches its terminal state. Settlement SHALL be observable identically in the live event stream and in the persisted assistant message: a client watching live and a client reloading from history SHALL see the same outcome for that call.

A settlement produced by termination SHALL be distinguishable in the durable record from a result produced by a tool that genuinely failed. The marker carrying that distinction SHALL survive every hop the record takes — the run-event log, the live event stream, the persisted assistant message, and history reconstruction — so no consumer has to infer termination from surrounding context. A presentation layer SHALL be able to render a terminated call differently from a failed one using only what the record carries.

Settlement SHALL be at most once per tool call. Once a call is settled, a later result for that same call SHALL affect neither the live stream nor the persisted message: the first settlement stands, and exactly one outcome for that call reaches each surface.

A terminated run SHALL NOT leave a tool rendered as running, and SHALL NOT drop the record that the call was requested.

#### Scenario: Cancelling mid-tool settles the call in the live stream

- **WHEN** a run is cancelled while a tool call is in flight
- **THEN** the live stream settles that tool's activity before finishing

#### Scenario: History shows the cancelled call, not an absent one

- **WHEN** the same run's chat is reloaded from persistence
- **THEN** the tool call appears with a cancelled outcome rather than being absent

#### Scenario: Live and reloaded views agree

- **WHEN** a run terminates with a tool call in flight
- **THEN** the outcome shown live and the outcome reconstructed from history are the same

#### Scenario: A cancellation settlement is distinguishable from a genuine failure

- **WHEN** the durable record of a terminated run is inspected
- **THEN** a call settled by termination is distinguishable from a call whose tool returned an error

#### Scenario: Settlement is idempotent per call

- **WHEN** a tool ignores cancellation and completes after its call was already settled by termination
- **THEN** the first settlement stands, the late result does not replace it, and both the live stream and the persisted message contain exactly one outcome for that call

#### Scenario: Expiry settles in-flight calls

- **WHEN** a run expires while a tool call is in flight
- **THEN** that call is settled on the same terms as cancellation, in the live stream and in history

#### Scenario: Failure settles in-flight calls

- **WHEN** a run fails while a tool call is in flight
- **THEN** that call is settled on the same terms, and remains distinguishable from a result the tool itself produced

#### Scenario: The chat UI presents a cancelled call as cancelled, not failed

- **WHEN** a chat containing a termination-settled tool call is viewed, live or reloaded from history
- **THEN** it is presented as cancelled rather than as a tool error, so the distinction in the durable record is the one the reader sees

### Requirement: Tool observations survive into later turns

A round's tool activity SHALL remain available to the model in later turns. The model's view of what happened in a round SHALL NOT degrade as the conversation moves past it: what a tool was asked, and what it returned or failed to return, SHALL still be representable on the next turn.

This is a user-facing contract, not only a continuity one. The chat UI renders tool results, so a reader can see output the model would otherwise have lost, and can reasonably expect to ask about it. A later turn SHALL be able to answer about a tool result the reader can see.

Each projected observation SHALL carry the tool's identity, what it was asked, and its **outcome status**. A call that was refused, cancelled, timed out, or errored SHALL be projected with that outcome rather than silently omitted — a history in which only successful calls appear invites the model to assume data it never received, or to retry something already refused. Where such a call produced no usable output, its outcome is what the projection reports in place of one.

Observations SHALL be replayed in the **conventional tool-call and tool-result representation** the model provider expects, expressed through the model SDK's portable message parts rather than hand-built provider-specific structures. Models are trained on that representation; the same content narrated as prose inside an assistant message is out-of-distribution and carries no structural signal that it came from a tool.

**Every replayed tool call SHALL be accompanied by its matching tool result.** The call-and-result pair is itself the trained pattern; a call left unmatched is not merely invalid to some providers but out-of-distribution, and degrades how the model reads the surrounding history. Supplying the pair is therefore required regardless of whether a given provider would tolerate its absence.

A call that produced no genuine result SHALL still be accompanied by a well-formed tool result carrying its termination or failure outcome — a proper result whose content reports what happened, not an omission and not prose narrating an absence. This is what makes the settlement guarantee above a prerequisite rather than a convenience: settlement is what ensures every call has an outcome available to pair with.

The projection SHALL be:

- **portable in this codebase** — expressed as the SDK's tool-call and tool-result parts, leaving per-provider representation to the SDK, so no provider-specific message assembly enters this codebase;
- **labelled untrusted** — the replayed result SHALL carry an explicit indication that its content is tool output which may contain text resembling instructions, and that such text is not authoritative;
- **escape-proofed** — replayed content SHALL NOT be able to close a structural boundary it did not open, nor emit a reserved structural name;
- **bounded** — per call and per turn, so replay cannot grow without limit;
- **stable once projected** — a given call's projection SHALL NOT change on subsequent turns, so the replayed prefix stays byte-identical for prompt caching.

Provider-native reasoning and provider metadata, credentials, and tool payloads unrelated to the projected call SHALL NOT be replayed.

Compaction MAY clear a projected observation's payload while preserving the call and its outcome status, so that long conversations retain what was attempted without retaining every result body.

The live tool loop SHALL continue to observe its own results within the turn that produced them.

#### Scenario: A later turn can use an earlier tool result

- **WHEN** a tool returns a result in one round and the user asks about that result in a later turn
- **THEN** the later turn's request carries the projected observation, including detail the assistant's visible answer did not restate

#### Scenario: An unsuccessful call is projected as unsuccessful

- **WHEN** a tool call was refused, errored, or timed out in an earlier round
- **THEN** later turns carry that call with its outcome status, rather than omitting it

#### Scenario: A cancelled call is projected as cancelled

- **WHEN** an earlier round's tool call was settled by run termination
- **THEN** later turns carry it as a call that produced no result, distinguishable from one whose tool returned an error

#### Scenario: A tool call made during reasoning is projected

- **WHEN** a tool is called while the model is producing reasoning output
- **THEN** its observation is projected on the same terms as any other tool call

#### Scenario: Every replayed call has a matching replayed result

- **WHEN** a later turn's request is assembled from history containing tool activity
- **THEN** every replayed tool call carries a corresponding result, including calls that produced none

#### Scenario: A call with no genuine result still carries a well-formed result

- **WHEN** a call that was cancelled, refused, errored or timed out is replayed
- **THEN** it is accompanied by a tool result reporting that outcome, in the same representation as any other result

#### Scenario: Provider reasoning and metadata are never replayed

- **WHEN** any turn's request is assembled from history containing tool activity
- **THEN** it carries no provider-native reasoning and no provider metadata from the originating model

#### Scenario: A model or provider switch keeps observations but not provider metadata

- **WHEN** a chat with prior tool activity continues on a different model or provider
- **THEN** the projected observations are still carried, in the new provider's expected representation, and provider metadata from the original model is not

#### Scenario: The projection is labelled untrusted

- **WHEN** a tool observation is projected into a later turn
- **THEN** its content indicates that it is tool output, and that instruction-like text within it is not authoritative

#### Scenario: Replayed content cannot escape its boundary

- **WHEN** a tool result contains markup attempting to close a surrounding boundary or forge a reserved structural name
- **THEN** the replayed form is neutralized and the surrounding structure is intact

#### Scenario: The projection is stable across turns

- **WHEN** the same tool call is projected on two successive turns
- **THEN** its projection is identical, so the replayed prefix does not change

#### Scenario: Compaction clears payloads but keeps the call

- **WHEN** compaction absorbs a round containing tool activity
- **THEN** the call and its outcome status remain representable while its result payload may be cleared

#### Scenario: The live loop still observes its own tool results

- **WHEN** a tool executes during a run
- **THEN** its result is available to the model within that same run's tool loop

## MODIFIED Requirements

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

This slice SHALL NOT checkpoint tool-loop state across worker death: a run that fails or expires mid-loop is not resumed — a retry re-executes tools from the start, which is acceptable **only because every executable tool is read-only**. The first write-capable tool SHALL NOT ship without introducing checkpoint-or-dedupe semantics for tool execution on retry. (Client refresh during a live run is unaffected — run-event replay reconstructs tool activity without re-execution.)

The retry that makes this load-bearing is concrete and always on: the run queue retries a failed **job attempt** under its own policy. A job attempt failing is not the same as the run reaching a terminal state — a retried attempt re-enters the tool loop from the first step only while its run is still claimable, and a run already terminal is never reopened. Re-execution is therefore the default behavior on infrastructure failure, not an edge case — a write-capable tool added without checkpoint-or-dedupe semantics would double-apply its effect on any transient worker failure, with no configuration change required to trigger it.

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps and the run is expired by the deadman
- **THEN** the run terminates per existing semantics; no partial tool-loop state is resumed on a new run

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects to a live run after tool steps have completed
- **THEN** the replayed stream reconstructs those steps from events without executing any tool again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** a run's job is retried by the queue and the run is still claimable
- **THEN** its tool loop executes from the first step again, re-invoking tools already invoked in the previous attempt

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** a job is retried for a run that has already reached a terminal state
- **THEN** the run is not reopened, no tool executes, and its terminal state stands
