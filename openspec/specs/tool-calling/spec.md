# tool-calling

## Purpose

The durable, multi-step tool-calling run loop: inside the transport-agnostic run executor, a run may interleave model output with tool invocations — the model requests a tool, the loop executes it (tenant-scoped, timeout-bounded), appends the result, and continues until a final answer or the operator step cap. Every tool is classified per SPEC §13.5 and only `read_only` tools execute in this slice; availability is a fail-closed operator allowlist (`tools.allowed`, default empty). Tool activity persists as AI-SDK tool parts + run events (replayable, rendered live and from history, excluded from public shares) and is display-only — never re-fed into model context. Approval flows (§7.5), write/execute/network tools, MCP/connectors, org/user grants, and the policy engine's deny-composition are out of scope here and extend this loop rather than replace it.

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

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

This slice SHALL NOT checkpoint tool-loop state across worker death: a run that fails or expires mid-loop is not resumed — a retry re-executes tools from the start, which is acceptable **only because every executable tool is read-only**. The first write-capable tool SHALL NOT ship without introducing checkpoint-or-dedupe semantics for tool execution on retry. (Client refresh during a live run is unaffected — run-event replay reconstructs tool activity without re-execution.)

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps and the run is expired by the deadman
- **THEN** the run terminates per existing semantics; no partial tool-loop state is resumed on a new run

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects to a live run after tool steps have completed
- **THEN** the replayed stream reconstructs those steps from events without executing any tool again

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
