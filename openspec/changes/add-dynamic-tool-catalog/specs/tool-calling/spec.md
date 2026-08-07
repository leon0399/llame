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

### Requirement: The tool-observation replay boundary is explicit and measured

Persisted tool activity is a durable display and audit record. What portion of it, if any, re-enters model context on a later turn SHALL be an explicit, tested contract rather than an incidental consequence of how messages are projected.

The boundary SHALL hold that raw persisted tool results, provider-native tool blocks, and provider-native reasoning or metadata are NOT replayed to a later turn, to a different model or provider, or into compaction input. The live tool loop SHALL continue to observe its own results within the turn that produced them.

#### Scenario: A later turn does not receive raw persisted tool results

- **WHEN** a chat with prior tool activity sends a subsequent message to the same model
- **THEN** the request carries no raw persisted tool result, provider-native tool block, or provider-native reasoning

#### Scenario: A model or provider switch does not receive them either

- **WHEN** a chat with prior tool activity continues on a different model or provider
- **THEN** the same exclusion holds

#### Scenario: Compaction input excludes them

- **WHEN** compaction assembles its input for a chat with prior tool activity
- **THEN** that input contains no raw persisted tool result, provider-native tool block, or provider-native reasoning

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
