## ADDED Requirements

### Requirement: Tool input schemas may be declared as JSON Schema

A tool SHALL be able to declare its input schema directly as JSON Schema, not only in code. Both forms SHALL receive the same argument validation, the same safety classification gate, the same operator allowlist gate, and the same tenant-scoped execution — neither form SHALL be privileged or exempted.

Comparing a bound snapshot declaration against its live tool SHALL NOT convert a schema that is already JSON Schema into another representation and back. A tool whose declaration has not changed SHALL therefore never be reported as drifted.

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

A settlement produced by termination SHALL be distinguishable in the durable record from a result produced by a tool that genuinely failed.

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

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5 set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, `admin`). In this slice the loop SHALL execute **only `read_only`** tools: a tool with any other classification SHALL be neither advertised to the model nor executed, even if registered and allowlisted — approval machinery (§7.5) arrives with the first write-capable tool.

Every registered tool SHALL additionally declare whether it is **safe to replay**, as a dimension separate from its safety classification. Safety classification answers how dangerous an action is; replay safety answers what happens if it executes twice, which a classification cannot express — two `read_only` tools can differ on it, and a run retried after a worker death re-executes its tool loop from the start. A tool declaring neither dimension SHALL NOT register. A tool that is not safe to replay SHALL be neither advertised nor executed while the loop provides no checkpoint-or-dedupe semantics for retry, and its exclusion SHALL be reported rather than silent.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called
- **THEN** it executes

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a tool classified other than `read_only` is registered and allowlisted, and the model requests it
- **THEN** it is not advertised to the model, and a direct request for it is refused with a recorded, non-fatal tool error

#### Scenario: Unclassified tool cannot register

- **WHEN** a tool without a classification is registered
- **THEN** registration fails at startup (fail loud, not at call time)

#### Scenario: Tool without declared replay safety cannot register

- **WHEN** a tool that does not declare whether it is safe to replay is registered
- **THEN** registration fails at startup naming the missing dimension

#### Scenario: Unsafe-to-replay tool is not advertised

- **WHEN** a registered tool declares that it is not safe to replay, and no checkpoint-or-dedupe semantics exist
- **THEN** it is neither advertised nor executable, and its exclusion is reported

#### Scenario: Duplicate tool id cannot register

- **WHEN** two tools register the same id
- **THEN** registration fails at startup naming the id
