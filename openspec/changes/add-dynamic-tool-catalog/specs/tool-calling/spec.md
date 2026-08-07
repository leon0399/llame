## ADDED Requirements

### Requirement: Catalog-driven tool sources

Advertised and executable tools SHALL be resolved through a single injected catalog rather than a fixed in-code registry. The in-code registry SHALL be one source contributing to that catalog, not the catalog itself, and the same catalog SHALL serve both advertisement (binding the immutable model-context snapshot) and execution (resolving an executor for a bound declaration), so the two can never disagree about what a tool is.

Every catalog entry SHALL declare its **origin** — the source that contributed it. A tool whose input schema is supplied as JSON Schema SHALL be a first-class catalog entry, equal in standing to one whose schema is authored in code; neither form SHALL receive weaker validation, classification, or gating than the other.

A tool id SHALL be unique across the whole catalog. When two sources contribute the same id, neither SHALL be advertised or executable, and the collision SHALL be reported — a silent last-writer-wins would let one source shadow another source's tool.

#### Scenario: A JSON-Schema tool is advertised and executed

- **WHEN** a catalog source contributes a tool whose input schema is JSON Schema, and that tool is allowlisted and classified `read_only`
- **THEN** it is advertised to the model, its arguments are validated against that schema, and it executes through the same path as a code-authored tool

#### Scenario: Advertisement and execution resolve through one catalog

- **WHEN** a run binds its model-context snapshot and later executes a tool from it
- **THEN** both resolve through the same catalog, and no tool can be advertised that the execution path cannot resolve

#### Scenario: Colliding ids from two sources fail closed

- **WHEN** two catalog sources contribute the same tool id
- **THEN** neither is advertised nor executable, and the collision is reported naming the id and both origins

#### Scenario: Origin is recorded for every entry

- **WHEN** the catalog is enumerated
- **THEN** every entry carries the origin that contributed it

### Requirement: Provider-legal tool identifiers

A tool id SHALL be usable verbatim as a provider function name. Ids SHALL be restricted to characters accepted by supported providers (`A`–`Z`, `a`–`z`, `0`–`9`, `_`, `-`) and SHALL be bounded in length. A dynamically sourced tool SHALL carry a **reserved namespace prefix** that identifies its source and cannot collide with a statically registered id.

An id that cannot be represented as a provider function name SHALL be rejected when its source contributes it, not at call time — a tool that cannot be named cannot be offered.

#### Scenario: Dynamic id is namespaced and provider-legal

- **WHEN** a dynamic source contributes a tool
- **THEN** its catalog id carries the reserved prefix for that source and contains only provider-legal characters

#### Scenario: Illegal id is rejected at contribution time

- **WHEN** a source contributes a tool whose id contains characters a provider will not accept as a function name
- **THEN** the tool is refused at contribution with a diagnostic naming the id, and no run advertises it

#### Scenario: A static id cannot occupy the dynamic namespace

- **WHEN** a statically registered tool declares an id using a reserved dynamic prefix
- **THEN** registration fails naming the id

### Requirement: Bound declaration drift withdraws the tool, not the run

The immutable model-context snapshot SHALL remain the authority for what was advertised. When a bound declaration no longer matches the live catalog entry for that id at execution time, **only that tool** SHALL be withdrawn for the turn: it SHALL NOT be offered to the model, a request for it SHALL take the ordinary unavailable-tool refusal path, and the run SHALL continue. The withdrawal SHALL be recorded as durable run activity naming the tool, so the snapshot receipt's account of what was advertised can be reconciled with what was executable.

A withdrawal SHALL NOT expire on a timer; a withdrawn tool SHALL become available again only when a live catalog entry matches its bound declaration.

#### Scenario: Drifted tool is withdrawn and the run continues

- **WHEN** a run's bound snapshot declares two tools and one no longer matches its live catalog entry
- **THEN** the other tool remains available, the run completes, and the drifted tool is neither advertised nor executed

#### Scenario: Withdrawal is recorded

- **WHEN** a tool is withdrawn for declaration drift
- **THEN** durable run activity records the withdrawal naming the tool

#### Scenario: A request for a withdrawn tool is refused, not fatal

- **WHEN** the model requests a tool that was withdrawn for this turn
- **THEN** a structured, non-fatal refusal result is recorded and the run proceeds

#### Scenario: An unresolvable bound tool does not fail the run

- **WHEN** a bound declaration has no live catalog entry at all
- **THEN** that tool is withdrawn on the same terms and the run continues

### Requirement: Cooperative cancellation reaches tool execution

Tool execution SHALL receive a cancellation signal derived from both the run's own termination and the effective per-call timeout, so a tool that supports cooperative cancellation can abandon in-flight work instead of running to completion after its result can no longer be used. A tool that ignores the signal SHALL still be bounded by the existing timeout, and SHALL still produce a structured result.

The signal SHALL be supplied by the trusted execution context, never from model-controlled arguments.

#### Scenario: Run cancellation reaches an executing tool

- **WHEN** a run is cancelled while a tool is executing
- **THEN** that tool's execution context observes cancellation

#### Scenario: Per-call timeout still bounds an uncooperative tool

- **WHEN** an executing tool ignores the cancellation signal
- **THEN** it is still bounded by its effective timeout and still yields a structured result

### Requirement: Termination settles in-flight tool activity

When a run terminates — cancelled, expired, or failed — every tool call that was requested but never settled SHALL be settled before the run reaches its terminal state. Settlement SHALL be observable identically in the live event stream, in the persisted assistant message, and in the durable event log: a client watching live and a client reloading from history SHALL see the same outcome for that call.

A settlement produced by termination SHALL be distinguishable in the durable record from a result produced by a tool that genuinely failed, so an audit can tell "this was cancelled" from "this errored".

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

### Requirement: Dynamically sourced tool metadata is untrusted input

A tool description, schema field description, or any other human-readable metadata contributed by a source outside this codebase SHALL be treated as untrusted data, not as authored instruction. Such metadata SHALL be neutralized before it enters the model-context snapshot, the hashes computed over it, or the owner-visible context receipt, using the same fail-closed treatment applied to other owner- and third-party-authored text: a value SHALL NOT be able to close a structural boundary it did not open, and SHALL NOT be able to emit a reserved structural name.

Neutralization SHALL be applied where the catalog entry is built, so no consumer can observe the un-neutralized form.

#### Scenario: Hostile description cannot escape its boundary

- **WHEN** a dynamic source contributes a tool whose description contains structural markup attempting to close a surrounding boundary or forge a reserved one
- **THEN** the neutralized form is what enters the snapshot, the hashes, and the receipt

#### Scenario: Ordinary description text is preserved

- **WHEN** a dynamic source contributes a plain-prose description
- **THEN** it is carried through unchanged in meaning

### Requirement: The tool-observation replay boundary is explicit and measured

Persisted tool activity is a durable display and audit record. What portion of it, if any, re-enters model context on a later turn SHALL be an explicit, tested contract rather than an incidental consequence of how messages are projected.

The boundary SHALL hold that raw persisted tool results, provider-native tool blocks, and provider-native reasoning or metadata are NOT replayed to a later turn, to a different model or provider, or into compaction input. The live tool loop SHALL continue to observe its own results within the turn that produced them.

Any projection of tool observations into later turns SHALL be provider-neutral, SHALL be labelled as untrusted historical data rather than as assistant-authored claims, SHALL be bounded, and once projected for a given call SHALL remain stable for every subsequent turn so that the replayed prefix does not change. Credentials, private metadata, and unrelated tool payloads SHALL NOT be projected.

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

#### Scenario: A projection, if present, is stable and labelled

- **WHEN** tool observations are projected into a later turn
- **THEN** each projection is labelled as untrusted historical data, is bounded, and does not change on subsequent turns

## MODIFIED Requirements

### Requirement: Tool registry with mandatory safety classification

Every tool entering the catalog — from any source — SHALL declare a safety classification from the SPEC §13.5 set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, `admin`). In this slice the loop SHALL execute **only `read_only`** tools: a tool with any other classification SHALL be neither advertised to the model nor executed, even if present in the catalog and allowlisted — approval machinery (§7.5) arrives with the first write-capable tool.

Every tool SHALL additionally declare its **replay safety** as a dimension separate from its safety classification. Safety classification answers "how dangerous is this action"; replay safety answers "what happens if this executes twice", which a classification cannot express — two `read_only` tools can differ in whether re-executing them on a retry is acceptable. A tool that declares neither dimension, or declares a value outside the permitted set for either, SHALL NOT enter the catalog.

A tool that is not safe to replay SHALL NOT be advertised or executed while the loop provides no checkpoint-or-dedupe semantics for tool execution on retry, and its exclusion SHALL be reported rather than silent.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called
- **THEN** it executes

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a tool classified other than `read_only` is in the catalog and allowlisted, and the model requests it
- **THEN** it is not advertised to the model, and a direct request for it is refused with a recorded, non-fatal tool error

#### Scenario: Unclassified tool cannot enter the catalog

- **WHEN** a tool without a safety classification is contributed
- **THEN** it is rejected when its source contributes it (fail loud, not at call time)

#### Scenario: Tool without declared replay safety cannot enter the catalog

- **WHEN** a tool that does not declare its replay safety is contributed
- **THEN** it is rejected when its source contributes it, naming the missing dimension

#### Scenario: Unsafe-to-replay tool is not advertised

- **WHEN** a tool declares that it is not safe to replay, and no checkpoint-or-dedupe semantics exist
- **THEN** it is neither advertised nor executable, and its exclusion is reported

#### Scenario: Duplicate tool id cannot register

- **WHEN** two tools register the same id
- **THEN** registration fails naming the id

### Requirement: Fail-closed operator availability gate

Tool availability SHALL be governed by the operator allowlist in `llame.config.json` (`tools.allowed`). The default SHALL be an empty allowlist — an instance with no tools configured runs exactly as before this change (no tools advertised, none executable). A tool absent from the allowlist SHALL be neither advertised to the model nor executed if requested.

Allowlist validation SHALL be split by id form, because a dynamically sourced tool cannot be known at boot:

- An id **outside** the reserved dynamic namespace SHALL be resolvable at boot; an unknown static id SHALL fail boot (strict config validation).
- An id **inside** the reserved dynamic namespace SHALL be validated at boot only to the extent its source can be checked — that the referenced source is declared in configuration. The tool itself SHALL resolve later, and until it does the tool SHALL be unavailable and fail closed, never advertised or executed on the assumption that it will appear.
- An id whose reserved namespace names a source that is not declared in configuration SHALL fail boot naming the offending config path and id.

An allowlisted-but-unresolved dynamic id SHALL NOT fail a run; it makes that tool unavailable for the run, nothing more.

#### Scenario: Default is no tools

- **WHEN** the operator config does not set `tools.allowed`
- **THEN** runs never advertise or execute any tool

#### Scenario: Unlisted tool is not advertised

- **WHEN** a catalog tool classified `read_only` is absent from the allowlist
- **THEN** it does not appear in the toolset offered to the model

#### Scenario: Unlisted tool is refused

- **WHEN** the model requests a catalog tool that is not in the allowlist
- **THEN** the call is refused with a recorded, non-fatal tool error and the run continues

#### Scenario: Unknown static tool id in the allowlist fails boot

- **WHEN** `tools.allowed` names a non-namespaced tool id that no source has registered
- **THEN** startup fails naming the offending config path and id

#### Scenario: Namespaced id for a declared source survives boot

- **WHEN** `tools.allowed` names a tool in the reserved namespace of a source that is declared in configuration, and that tool has not yet resolved
- **THEN** startup succeeds and the tool is unavailable until it resolves

#### Scenario: Namespaced id for an undeclared source fails boot

- **WHEN** `tools.allowed` names a tool whose reserved namespace refers to a source not declared in configuration
- **THEN** startup fails naming the offending config path and id

#### Scenario: An unresolved allowlisted tool does not fail a run

- **WHEN** a run executes while an allowlisted namespaced tool is still unresolved
- **THEN** the run proceeds with the remaining available tools

### Requirement: Durable, replayable tool activity

Tool calls and results SHALL persist as structured parts on the assistant message and stream as run events, with the same durability and replay guarantees as text/reasoning: a client that reconnects or refreshes mid-tool-execution SHALL reconstruct the full tool activity from the event stream/persisted parts. When a run hits the step cap, a structured **cap-marker part** SHALL persist on the assistant message alongside the call/result parts (history loads message parts, not run events — the cap notice must be reconstructable from persistence alone). Public chat sharing SHALL NOT expose tool parts (the existing text-only egress allowlist already excludes them — this requirement pins that it stays true for the new parts).

Persisted and streamed tool activity SHALL be redacted on the write path, not only where it is logged. Values recognizable as credentials or secrets, whether they appear in a tool's arguments or in its result, SHALL NOT be written to durable run activity in recoverable form. Redaction SHALL be applied before persistence, so a durable record can never hold a secret that a later reader is trusted not to look at.

#### Scenario: Tool activity survives refresh

- **WHEN** the user refreshes mid-run while a tool is executing
- **THEN** the resumed stream reconstructs the tool call, its in-progress state, and (once done) its result

#### Scenario: Cap marker persists with the message

- **WHEN** a run hits the step cap and later completes
- **THEN** the assistant message's persisted parts include the cap marker, and a full chat reload renders the cap notice from it

#### Scenario: Tool parts never reach public shares

- **WHEN** a chat containing tool calls/results is shared publicly
- **THEN** the public payload contains no tool parts

#### Scenario: Secrets in tool arguments are not persisted

- **WHEN** a tool is called with an argument value recognizable as a credential
- **THEN** the durable run activity does not contain that value in recoverable form

#### Scenario: Secrets in tool results are not persisted

- **WHEN** a tool result contains a value recognizable as a credential
- **THEN** the durable run activity does not contain that value in recoverable form

### Requirement: Tool failure is an observation, not a crash

A tool that throws, times out, or returns invalid output SHALL produce a structured error result — recorded, streamed, and visible to the model — and the run SHALL continue (the model may retry, use another tool, or answer without it). Tool execution SHALL be bounded by a timeout: the global `tools.callTimeoutSeconds` (operator config, documented built-in default 15), overridable per tool at registration; a timed-out call yields a structured error result like any other failure. Tool errors SHALL never fail the run by themselves and SHALL never expose internal stack traces, configuration values, or secrets in the recorded result — and that exclusion SHALL apply equally to the recorded call arguments, not only to the result. Oversized tool results SHALL be truncated to a documented cap with a visible truncation marker in the result.

#### Scenario: Tool error surfaces to the model and the run continues

- **WHEN** an executing tool throws
- **THEN** an error result part is recorded, the model observes it, and the run proceeds to a final answer

#### Scenario: Tool call times out

- **WHEN** a tool exceeds its effective timeout (per-tool override, else the global config value)
- **THEN** execution is aborted and a structured timeout error result is recorded; the run continues

#### Scenario: Error results carry no internals

- **WHEN** a tool error result is recorded
- **THEN** it contains a user-appropriate message, not a stack trace or configuration values

#### Scenario: Recorded arguments carry no internals

- **WHEN** a tool call's arguments are recorded
- **THEN** they contain no credential or configuration value in recoverable form
