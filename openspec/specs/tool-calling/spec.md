# tool-calling

## Purpose

The durable, multi-step tool-calling run loop: inside the transport-agnostic run executor, a run may interleave model output with tool invocations — the model requests a tool, the loop executes it (tenant-scoped, timeout-bounded), appends the result, and continues until a final answer or the operator step cap. Every tool is classified per SPEC §13.5 and only `read_only` tools execute in this slice; availability is a fail-closed operator allowlist (`tools.allowed`, default empty). Tool activity persists as AI-SDK tool parts + run events (replayable, rendered live and from history, excluded from public shares) and is replayed into later model turns as conventional tool-call/tool-result parts — labelled untrusted, escape-proofed, bounded per call and per turn. Approval flows (§7.5), write/execute/network tools, MCP/connectors, org/user grants, and the policy engine's deny-composition are out of scope here and extend this loop rather than replace it.

## Requirements

### Requirement: Multi-step tool-calling run loop

The run executor SHALL support multi-step runs: when the model requests tool invocations, the loop SHALL execute them, append the results to the run's model context, and continue the same run — repeating until the model produces a final answer or the step cap is reached. A **step** is one model turn that requested at least one tool. A model MAY request multiple tool calls in a single turn: they count as **one** step and execute **concurrently** (safe: read-only + individually timeout-bounded), each producing its own call/result parts. The step cap SHALL be evaluated per step, atomically: the turn that reaches the cap executes ALL of its requested calls; no call within an accepted step is refused because of the cap. The loop SHALL run inside the existing durable worker execution (queue-processed, heartbeated, resumable) — never on the request thread.

#### Scenario: Model calls a tool and continues

- **WHEN** the model requests an available tool with valid arguments
- **THEN** the tool executes, its result enters the model context, and the model continues the same run to a final answer

#### Scenario: Multiple sequential tool steps

- **WHEN** the model chains several tool-requesting turns within one run
- **THEN** each executes in order and the conversation context accumulates every call and result

#### Scenario: Parallel tool calls within one turn count as one step

- **WHEN** the model requests three tool calls in a single turn
- **THEN** all three execute concurrently, each with its own call/result parts, and the step counter increments by one

#### Scenario: The cap-reaching step completes atomically

- **WHEN** the step cap is 8, seven steps have run, and the model requests three tool calls in its eighth tool-requesting turn
- **THEN** all three calls of that step execute; afterwards no further tools are offered or executed

#### Scenario: Step cap reached fails closed to answering

- **WHEN** a run reaches the configured maximum tool steps
- **THEN** no further tool calls execute; the model is driven to answer from what it has, and the run completes with the cap visibly recorded in the run's events

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5 set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, `admin`). In this slice the loop SHALL execute **only `read_only`** tools: a tool with any other classification SHALL be neither advertised to the model nor executed, even if registered and allowlisted — approval machinery (§7.5) arrives with the first write-capable tool.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called
- **THEN** it executes

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a tool classified other than `read_only` is registered and allowlisted, and the model requests it
- **THEN** it is not advertised to the model, and a direct request for it is refused with a recorded, non-fatal tool error

#### Scenario: Unclassified tool cannot register

- **WHEN** a tool without a classification is registered
- **THEN** registration fails at startup (fail loud, not at call time)

#### Scenario: Duplicate tool id cannot register

- **WHEN** two tools register the same id
- **THEN** registration fails at startup naming the id

### Requirement: Fail-closed operator availability gate

Tool availability SHALL be governed by the operator allowlist in `llame.config.json` (`tools.allowed`). The default SHALL be an empty allowlist — an instance with no tools configured runs exactly as before this change (no tools advertised, none executable). A tool absent from the allowlist SHALL be neither advertised to the model nor executed if requested. Unknown tool ids in the allowlist SHALL fail boot (strict config validation).

#### Scenario: Default is no tools

- **WHEN** the operator config does not set `tools.allowed`
- **THEN** runs never advertise or execute any tool

#### Scenario: Unlisted tool is not advertised

- **WHEN** a registered `read_only` tool is absent from the allowlist
- **THEN** it does not appear in the toolset offered to the model

#### Scenario: Unlisted tool is refused

- **WHEN** the model requests a registered tool that is not in the allowlist
- **THEN** the call is refused with a recorded, non-fatal tool error and the run continues

#### Scenario: Unknown tool id in the allowlist fails boot

- **WHEN** `tools.allowed` names a tool id that is not registered
- **THEN** startup fails naming the offending config path and id

### Requirement: Tenant-scoped tool execution

Every datastore access a tool performs SHALL run inside the run owner's tenant transaction (`runAs(ownerUserId)`, RLS-enforced) — a tool can never read or write another tenant's rows, enforced at the datastore, not by tool-author discipline. Tool execution with no established owner identity SHALL fail closed (the tool errors; nothing is read).

#### Scenario: Tool reads only the owner's data

- **WHEN** a tool queries data while executing in user A's run, and matching rows exist for user A and user B
- **THEN** only user A's rows are visible to the tool

#### Scenario: Cross-tenant access is denied at the datastore

- **WHEN** a tool attempts to read a specific resource owned by another tenant
- **THEN** the datastore returns no rows, independent of application-layer checks

#### Scenario: Absent identity fails closed

- **WHEN** tool execution is attempted without a resolvable run owner
- **THEN** the tool call fails with an error and performs no reads

### Requirement: First tool is internal, read-only, own-data

The initial toolset SHALL consist of exactly one tool — conversation search over the requesting user's own chats — and it SHALL be implemented against the **same server-side search service the web chat search uses** (one search path: a future retrieval upgrade improves both surfaces simultaneously). No tool in this slice SHALL reach the external network: an outbound-fetching tool is a context-exfiltration channel (§7.5) and SHALL NOT ship before the approval framework.

#### Scenario: Conversation search over own chats

- **WHEN** the model invokes the conversation-search tool with a query
- **THEN** it returns matches only from chats owned by the run's owner

#### Scenario: Tool and UI search share one implementation

- **WHEN** the conversation-search tool and the web chat search execute the same query for the same user
- **THEN** both are served by the same underlying search service (no parallel query path)

#### Scenario: No external network egress from tools

- **WHEN** the shipped toolset of this slice is enumerated
- **THEN** none performs outbound network requests

### Requirement: Durable, replayable tool activity

Tool calls and results SHALL persist as structured parts on the assistant message and stream as run events, with the same durability and replay guarantees as text/reasoning: a client that reconnects or refreshes mid-tool-execution SHALL reconstruct the full tool activity from the event stream/persisted parts. When a run hits the step cap, a structured **cap-marker part** SHALL persist on the assistant message alongside the call/result parts (history loads message parts, not run events — the cap notice must be reconstructable from persistence alone). Public chat sharing SHALL NOT expose tool parts (the existing text-only egress allowlist already excludes them — this requirement pins that it stays true for the new parts).

#### Scenario: Tool activity survives refresh

- **WHEN** the user refreshes mid-run while a tool is executing
- **THEN** the resumed stream reconstructs the tool call, its in-progress state, and (once done) its result

#### Scenario: Cap marker persists with the message

- **WHEN** a run hits the step cap and later completes
- **THEN** the assistant message's persisted parts include the cap marker, and a full chat reload renders the cap notice from it

#### Scenario: Tool parts never reach public shares

- **WHEN** a chat containing tool calls/results is shared publicly
- **THEN** the public payload contains no tool parts

### Requirement: Tool failure is an observation, not a crash

A tool that throws, times out, or returns invalid output SHALL produce a structured error result — recorded, streamed, and visible to the model — and the run SHALL continue (the model may retry, use another tool, or answer without it). Tool execution SHALL be bounded by a timeout: the global `tools.callTimeoutSeconds` (operator config, documented built-in default 15), overridable per tool at registration; a timed-out call yields a structured error result like any other failure. Tool errors SHALL never fail the run by themselves and SHALL never expose internal stack traces or secrets in the recorded result. Oversized tool results SHALL be truncated to a documented cap with a visible truncation marker in the result.

#### Scenario: Tool error surfaces to the model and the run continues

- **WHEN** an executing tool throws
- **THEN** an error result part is recorded, the model observes it, and the run proceeds to a final answer

#### Scenario: Tool call times out

- **WHEN** a tool exceeds its effective timeout (per-tool override, else the global config value)
- **THEN** execution is aborted and a structured timeout error result is recorded; the run continues

#### Scenario: Error results carry no internals

- **WHEN** a tool error result is recorded
- **THEN** it contains a user-appropriate message, not a stack trace or configuration values

### Requirement: Tool input schemas may be declared as JSON Schema

A tool SHALL be able to declare its input schema directly as JSON Schema, not only in code. Both forms SHALL receive the same argument validation, the same safety classification gate, the same operator allowlist gate, and the same tenant-scoped execution — neither form SHALL be privileged or exempted.

Argument validation SHALL be **effective**, not merely declared: a schema whose constraints are advertised to the provider but never checked against the returned arguments does not satisfy this requirement. Where the model SDK validates only when a validator is present, one SHALL be supplied, and a failure SHALL surface through the same non-fatal refusal path as any other invalid tool call rather than through a separate error shape.

A tool's schema SHALL be consumed without dialect rewriting. Nothing in this codebase SHALL require a source to declare, restate, or adjust its schema to a preferred JSON Schema dialect — external sources author their own schemas. A schema that declares a supported dialect and compiles successfully SHALL be accepted as shipped; lack of an available validator or compilation failure remains the explicit refusal case below.

Arguments SHALL be validated under the dialect the schema itself declares. Where no `$schema` is declared, draft-07 SHALL be assumed, matching both the model SDK's tool-schema typing and prevailing practice for tool schemas. Semantically equivalent URI forms for a supported dialect SHALL resolve to the same validator without rewriting the source document. A schema SHALL be refused only when it cannot be checked faithfully: no validator for its declared dialect is available, or the schema is malformed or invalid and cannot be compiled by that validator. The refusal SHALL name the affected tool and declared or assumed dialect, SHALL happen before the declaration enters the immutable context snapshot, and SHALL NOT affect valid sibling tools. Validating a schema under a dialect other than its own SHALL NOT be done, because keywords such as `items` carry different meaning between dialects and the mismatch would silently enforce something the author did not write.

Standard JSON Schema formats supported by the validator integration, including `email`, `uri`, and `date-time`, SHALL be enforced when a schema declares them. Advertising a format while silently accepting values that violate it does not satisfy effective validation.

Comparing a bound snapshot declaration against its live tool SHALL NOT convert a schema that is already JSON Schema into another representation and back. Comparison SHALL be by **canonical equality**: two declarations are equal when their canonical forms — recursively key-sorted, with no other normalization — are identical. Key order and other insignificant serialization differences SHALL NOT count as drift; any difference in schema content SHALL. The same canonicalization SHALL be used when the snapshot is written and when it is compared, so the two can never disagree.

#### Scenario: A schema is validated under its own declared dialect

- **WHEN** a source contributes a tool whose input schema declares a dialect for which a validator is available
- **THEN** the tool is accepted as shipped, and its arguments are validated under that dialect

#### Scenario: A schema without a declared dialect is accepted

- **WHEN** a source contributes a tool whose input schema declares no `$schema`
- **THEN** the tool is accepted and its arguments are validated under the assumed default

#### Scenario: An unsupported dialect refuses only the affected tool

- **WHEN** a source contributes a tool whose schema declares a dialect no available validator supports
- **THEN** that tool is refused, naming the tool and the dialect, and the refusal does not affect other tools from the same source

#### Scenario: A malformed schema refuses only the affected tool

- **WHEN** a source contributes one tool whose schema cannot compile and another tool with a valid schema
- **THEN** the malformed tool is refused before snapshotting, naming the tool and dialect, while the valid sibling remains available

#### Scenario: Equivalent supported dialect URIs select the same validator

- **WHEN** two otherwise-equivalent schemas declare canonical URI variants of the same supported dialect
- **THEN** both are validated under that dialect without rewriting either source schema

#### Scenario: Standard formats are enforced

- **WHEN** a JSON Schema constrains an argument using the supported `email`, `uri`, or `date-time` format
- **THEN** a conforming value is accepted and a non-conforming value is refused before execution

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
- **THEN** the call does not execute, a structured non-fatal error result is recorded, and the run continues

#### Scenario: A schema advertised to the provider is also enforced locally

- **WHEN** a JSON-Schema tool is called with arguments that violate its schema but that the provider returned anyway
- **THEN** the violation is caught before the tool executes

#### Scenario: An unchanged JSON-Schema tool rebinds without spurious drift

- **WHEN** a run binds a snapshot declaring a JSON-Schema tool and later executes it, with nothing about that tool changed
- **THEN** the declaration matches and the tool executes

#### Scenario: Tool activity from a JSON-Schema tool reconstructs from history

- **WHEN** a chat containing a completed JSON-Schema tool call is reloaded
- **THEN** the persisted parts reconstruct the same call and result presentation as a code-authored tool

### Requirement: Cooperative cancellation reaches tool execution

Tool execution SHALL receive a cancellation signal derived from both the run's termination and the effective per-call timeout, so a tool that supports cooperative cancellation can abandon work whose result can no longer be used. The same per-call timeout signal SHALL drive both the execution context and the timeout race. A tool that ignores the signal SHALL still be bounded by that timeout and SHALL still produce a structured result. The signal SHALL come from the trusted execution context, never from model-controlled arguments.

A cooperative rejection caused by the per-call timeout SHALL produce the structured `timeout` outcome. A rejection caused by the parent run abort SHALL NOT be recorded as `execution_failed` or win first settlement; the call SHALL remain open for the run's terminal settlement so its durable outcome agrees with the terminal run state.

#### Scenario: Run cancellation reaches an executing tool

- **WHEN** a run is cancelled while a tool is executing
- **THEN** that tool's execution context observes cancellation

#### Scenario: Per-call timeout still bounds an uncooperative tool

- **WHEN** an executing tool ignores the cancellation signal
- **THEN** it is still bounded by its effective timeout and still yields a structured result

#### Scenario: A cooperative per-call timeout remains a timeout

- **WHEN** a tool rejects after observing its per-call timeout signal
- **THEN** its structured outcome is `timeout`, not `execution_failed`

#### Scenario: A parent abort remains terminal settlement

- **WHEN** a tool rejects after observing the parent run abort
- **THEN** that rejection does not settle the call as `execution_failed`, and the run's terminal settlement supplies the first and only durable outcome

### Requirement: Termination settles in-flight tool activity

When a run terminates — cancelled, expired, or failed — every tool call that was requested but never settled SHALL be settled before the run reaches its terminal state. Settlement SHALL be observable identically in the live event stream and in the persisted assistant message: a client watching live and a client reloading from history SHALL see the same outcome for that call.

A settlement produced by termination SHALL be distinguishable in the durable record from a result produced by a tool that genuinely failed. The marker carrying that distinction SHALL survive every hop the record takes — the run-event log, the live event stream, the persisted assistant message, and history reconstruction — so no consumer has to infer termination from surrounding context. A presentation layer SHALL be able to render a terminated call differently from a failed one using only what the record carries.

Settlement SHALL be at most once per tool call. Once a call is settled, a later result for that same call SHALL affect neither the live stream nor the persisted message: the first settlement stands, and exactly one outcome for that call reaches each surface.

A terminated run SHALL NOT leave a tool rendered as running, and SHALL NOT drop the record that the call was requested.

A worker SHALL acknowledge a drained model stream only after the owner-scoped Run is durably terminal. If an asynchronous model or tool callback fails to persist settlement but the SDK resolves stream consumption, the worker SHALL reject that job attempt so the queue can retry. A cancellation observed at either worker pickup gate SHALL use the same central terminal settlement path, so a retried attempt with durable open tool events settles them before publishing the terminal Run event.

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

#### Scenario: A swallowed settlement write failure remains retryable

- **WHEN** an asynchronous parent-abort settlement cannot persist an open call and the model SDK nevertheless resolves stream consumption
- **THEN** the worker does not acknowledge the job while the owner-scoped Run remains nonterminal
- **AND** a cancellation observed on retry uses central settlement to reconstruct and settle durable open calls before the terminal event

### Requirement: Tool observations survive into later turns

A round's tool activity SHALL remain available to the model in later turns within the bounded replay contract below. What a tool was asked, and what it returned or failed to return, SHALL be representable on the next turn unless an older complete observation must be omitted to enforce the hard budget.

This is a user-facing contract, not only a continuity one. The chat UI renders tool results, so a reader can see output the model would otherwise have lost, and can reasonably expect to ask about it. A later turn SHALL be able to answer about a tool result the reader can see.

Each projected observation SHALL carry the tool's identity, what it was asked when its payload fits, and its **outcome status**. New tool activity SHALL persist that structured outcome as `success` or the runner's exact error type. A call that was refused, cancelled, timed out, unavailable, execution-failed, search-failed, or otherwise errored SHALL be projected with that outcome rather than silently omitted. Legacy output-error rows without a structured outcome SHALL map to generic `error` without parsing human prose; the existing structured cancellation metadata MAY recover the legacy `cancelled` distinction.

Observations SHALL be replayed in the **conventional tool-call and tool-result representation** the model provider expects, expressed through the model SDK's portable message parts rather than hand-built provider-specific structures. Models are trained on that representation; the same content narrated as prose inside an assistant message is out-of-distribution and carries no structural signal that it came from a tool.

**Every replayed tool call SHALL be accompanied by its matching tool result.** The call-and-result pair is itself the trained pattern; a call left unmatched is not merely invalid to some providers but out-of-distribution, and degrades how the model reads the surrounding history. Supplying the pair is therefore required regardless of whether a given provider would tolerate its absence.

A call that produced no genuine result SHALL still be accompanied by a well-formed tool result carrying its termination or failure outcome — a proper result whose content reports what happened, not an omission and not prose narrating an absence. This is what makes the settlement guarantee above a prerequisite rather than a convenience: settlement is what ensures every call has an outcome available to pair with.

The projection SHALL be:

- **portable in this codebase** — expressed as the SDK's tool-call and tool-result parts, leaving per-provider representation to the SDK, so no provider-specific message assembly enters this codebase;
- **labelled untrusted** — the replayed result SHALL carry an explicit indication that its content is tool output which may contain text resembling instructions, and that such text is not authoritative;
- **escape-proofed** — replayed content SHALL NOT be able to close a structural boundary it did not open, nor emit a reserved structural name in any spelling: case variants, whitespace-padded, attribute-bearing, or unterminated forms SHALL all be neutralized, matching the fail-closed reserved-name handling the existing sanitizer already applies;
- **bounded over the complete envelope** — limits SHALL be measured in JavaScript UTF-16 code units (`String.length`) over the exact serialized assistant-call/tool-result message pair, including input, identifiers, tool names, untrusted label, outcome, and result body. The limits SHALL be 8,000 code units per pair and 32,000 code units per stored assistant turn or compacted ledger. Bytes, Unicode code points, and informal `KB` SHALL NOT be used as substitute units;
- **reduced under explicit precedence** — pairing SHALL take precedence over the hard budget, which SHALL take precedence over retaining newer observations, which SHALL take precedence over retaining payload detail. Payloads SHALL be cleared oldest-first only when clearing makes the envelope smaller. If irreducible cleared pairs still exceed a limit, the oldest complete pairs SHALL be dropped atomically until it fits, with one bounded omission count/marker. The count SHALL be a non-negative safe integer and SHALL saturate rather than overflow. An unmatched call or result SHALL never be emitted;
- **stable at each durable boundary** — the same unmodified stored turn SHALL project byte-identically on successive turns. A compacted observation SHALL stay payload-cleared in the persisted ledger and SHALL NOT be re-expanded. Later compaction MAY omit older complete pairs to keep that growing ledger within its hard limit.

Both the untrusted indication and the outcome status SHALL live **inside the replayed result's own content**, not in provider-specific fields, since the portable representation offers none. This does not reintroduce the out-of-distribution problem the representation choice avoids: a tool result whose content carries structured text is exactly what a tool result is, whereas narrating a tool call as assistant prose is not.

Provider-native reasoning and provider metadata, credentials, and tool payloads unrelated to the projected call SHALL NOT be replayed.

Persisted assistant parts SHALL replay in occurrence order. Visible text before a call SHALL be emitted as its own assistant message immediately before a standalone assistant-call message; that call's result SHALL follow immediately, and later assistant text SHALL be its own message after the result. The single omission marker SHALL likewise be its own assistant message at the earliest omitted occurrence. Visible assistant text SHALL NOT count toward the observation budget or cause an otherwise-retained pair to be dropped. Because the persisted shape does not identify a consecutive set as parallel, consecutive calls SHALL be serialized conservatively as one standalone assistant-call/tool-result pair at a time in occurrence order.

Compaction SHALL persist a versioned, runtime-validated ledger of cleared call identity and structured outcome. A normal or model-transition compaction SHALL combine the previous ledger with newly absorbed observations, enforce the same complete-pair budget, and persist the result on the new compaction row. Model replay and the cache-aligned compaction request SHALL order the generated checkpoint first, the compacted ledger second, and the live window last. The ledger SHALL remain RLS-scoped internal state and SHALL NOT enter public DTOs, search indexes, or exports. An invalid or unknown ledger version SHALL fail closed to the valid empty ledger.

The live tool loop SHALL continue to observe its own results within the turn that produced them.

#### Scenario: A later turn can use an earlier tool result

- **WHEN** a tool returns a result in one round and the user asks about that result in a later turn
- **THEN** the later turn's request carries the projected observation, including detail the assistant's visible answer did not restate

#### Scenario: An unsuccessful call is projected as unsuccessful

- **WHEN** a tool call was refused, errored, or timed out in an earlier round
- **THEN** later turns carry that call with its outcome status, rather than omitting it

#### Scenario: A cancelled call is projected as cancelled

- **WHEN** an earlier round's tool call was settled by run termination
- **THEN** later turns carry that call accompanied by a well-formed tool result reporting the termination, distinguishable from one whose tool returned an error

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

- **WHEN** a tool result contains markup attempting to close a surrounding boundary or forge a reserved structural name, in any spelling including case variants, padded, attribute-bearing, and unterminated forms
- **THEN** every such form is neutralized and the surrounding structure is intact

#### Scenario: The projection is stable across turns

- **WHEN** the same tool call is projected on two successive turns
- **THEN** its projection is identical, so the replayed prefix does not change

#### Scenario: Interleaved text and tools retain chronology

- **WHEN** a persisted assistant turn contains text, a tool call, and later text
- **THEN** replay emits standalone leading assistant text, then a standalone assistant-call message, its matching result next, and standalone later assistant text afterward
- **AND** consecutive calls are replayed as sequential matched pairs when the persisted data cannot prove they were parallel

#### Scenario: Visible text does not consume the observation budget

- **WHEN** a capped turn contains substantial visible assistant text before and after omitted tool observations
- **THEN** the visible text and one omission marker retain their occurrence order as standalone assistant messages
- **AND** the exact marker-plus-pair observation sequence remains within 32,000 UTF-16 code units without dropping pairs because of the unrelated visible text

#### Scenario: Hard limits preserve pairing and newest observations

- **WHEN** a full serialized pair exceeds 8,000 UTF-16 code units or a turn or compacted ledger exceeds 32,000 UTF-16 code units
- **THEN** oldest payloads are cleared only when that shrinks the envelope
- **AND** if cleared pairs still do not fit, oldest complete pairs are omitted atomically until the envelope fits
- **AND** exactly one bounded omission count/marker is emitted, newer pairs are preferred, and call/result counts remain equal

#### Scenario: Compaction carries cleared observations across lineage

- **WHEN** normal or model-transition compaction absorbs tool activity
- **THEN** the new v1 ledger combines the prior ledger and newly absorbed identity/outcome observations without payloads
- **AND** the next model request contains checkpoint, bounded ledger pairs, and live history in that order
- **AND** the ledger remains absent from public DTO, search, and export surfaces

#### Scenario: Existing compactions cannot recover already-absorbed observations

- **WHEN** the ledger migration applies to a compaction created before structured observation retention
- **THEN** that row receives a valid empty v1 ledger
- **AND** no tool identity or outcome is inferred from its prose summary

#### Scenario: The live loop still observes its own tool results

- **WHEN** a tool executes during a run
- **THEN** its result is available to the model within that same run's tool loop

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

### Requirement: Tool activity is rendered in the chat UI

The web chat SHALL render tool activity inline in the message stream — the call (tool name + arguments summary), a running state, and the result (or error) — consistent with the existing part renderers (text, reasoning), including for historical messages loaded from persistence.

#### Scenario: Live rendering during a run

- **WHEN** a tool executes during a streamed run
- **THEN** the UI shows the call and its running state, then the result, without a refresh

#### Scenario: Historical rendering

- **WHEN** a chat containing past tool activity is reopened
- **THEN** the persisted tool parts render the same call/result presentation

#### Scenario: Step-cap notice is visible in the UI

- **WHEN** a run hits the step cap
- **THEN** the chat UI renders a visible inline notice alongside the final answer (live and when reloaded from history)
