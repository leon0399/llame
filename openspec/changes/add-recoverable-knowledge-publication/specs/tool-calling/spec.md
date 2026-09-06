## RENAMED Requirements

- FROM: `### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)`
- TO: `### Requirement: Tool retries reconcile Knowledge effects before model execution`

## MODIFIED Requirements

### Requirement: Multi-step tool-calling run loop

The run executor SHALL support multi-step runs: when the model requests tool invocations, the loop SHALL execute them, append the results to the run's model context, and continue the same run — repeating until the model produces a final answer or the step cap is reached. A **step** is one model turn that requested at least one tool. A model MAY request multiple tool calls in a single turn: they count as **one** step and execute concurrently when independent and read-only. Calls that touch the same writable executor view SHALL execute in provider-emitted order, including reads, draft mutations, and publication, each individually timeout-bounded, each producing its own call/result parts. The step cap SHALL be evaluated per step, atomically: the turn that reaches the cap executes ALL of its requested calls; no call within an accepted step is refused because of the cap. The loop SHALL run inside the existing durable worker execution (queue-processed, heartbeated, resumable) — never on the request thread.

#### Scenario: Model calls a tool and continues

- **WHEN** the model requests an available tool with valid arguments
- **THEN** the tool executes, its result enters the model context, and the model continues the same run to a final answer

#### Scenario: Multiple sequential tool steps

- **WHEN** the model chains several tool-requesting turns within one run
- **THEN** each executes in order and the conversation context accumulates every call and result

#### Scenario: Parallel tool calls within one turn count as one step

- **WHEN** the model requests three independent read-only tool calls in a single turn
- **THEN** all three execute concurrently, each with its own call/result parts, and the step counter increments by one

#### Scenario: The cap-reaching step completes atomically

- **WHEN** the step cap is 8, seven steps have run, and the model requests three tool calls in its eighth tool-requesting turn
- **THEN** all three calls of that step execute; afterwards no further tools are offered or executed

#### Scenario: Step cap reached fails closed to answering

- **WHEN** a run reaches the configured maximum tool steps
- **THEN** no further tool calls execute; the model is driven to answer from what it has, and the run completes with the cap visibly recorded in the run's events

#### Scenario: Read edit and publish share one view

- **WHEN** a model step emits a read, edit, and publication against the same writable view
- **THEN** they execute in emitted order and each receives an explicit result
- **AND** the publication cannot race the edit or bypass a failed precondition

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5 set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, `admin`). The loop SHALL execute admitted `read_only` tools and only the exact first-party `write`, `edit`, and `publish` implementations registered by the executor-file-views and knowledge-publication capabilities. Those three tools SHALL declare `write_low_risk` and SHALL remain unavailable until their durable publication recovery and current owner/view policy are installed. Classification alone SHALL NOT admit any other write or execution tool. Personal implementations SHALL retain individual operation approval; hosted publication SHALL require owner-managed enablement plus exact operator eligibility. This does not introduce general approval UI or permit remote MCP writes.

The `mcp__` tool-id prefix SHALL be reserved for ids produced by the MCP capability. A code-owned or other non-MCP registry entry beginning with that prefix SHALL fail registration, so ID-only namespace permission matching cannot grant authority across source kinds.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called
- **THEN** it executes

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a tool outside the exact first-party write set is classified other than `read_only`, registered and allowlisted, and the model requests it
- **THEN** it is not advertised to the model, and a direct request for it is refused with a recorded, non-fatal tool error

#### Scenario: Unclassified tool cannot register

- **WHEN** a tool without a classification is registered
- **THEN** registration fails at startup (fail loud, not at call time)

#### Scenario: Duplicate tool id cannot register

- **WHEN** two tools register the same id
- **THEN** registration fails at startup naming the id

#### Scenario: Code-owned tool cannot occupy the MCP namespace

- **WHEN** a code-owned registry entry has an id beginning with `mcp__`
- **THEN** registration fails at startup naming the reserved prefix

#### Scenario: First-party write gate is not a classification bypass

- **WHEN** an unrelated tool or MCP operation claims write-low-risk or replay safety
- **THEN** it remains ineligible despite that declaration
- **AND** only the code-owned admitted implementation can use the publication path

### Requirement: Fail-closed operator availability gate

Tool eligibility SHALL be governed by the operator allowlist in `llame.config.json` (`tools.allowed`). The default SHALL be an empty allowlist — an instance with no tools configured runs exactly as before this change (no tools advertised, none executable). The system SHALL first construct its source-owned inventory from registered code-owned tools and the safely admitted current or remembered-unavailable MCP inventory, then apply `tools.allowed` strictly as a boolean permission predicate over each candidate's canonical `tool.id`. Code-owned ids SHALL require exact entries. A canonical MCP id SHALL match either the same exact entry or a validated namespace rule `mcp__<configured-server>__*` whose terminal `*` is removed for literal ID-prefix comparison. Matching SHALL be case-sensitive. The validated trailing separator SHALL prevent one server prefix from matching a longer server id, and the reserved `mcp__` namespace SHALL prevent matching code-owned tools. Permission rules SHALL NOT create, copy, expand, or deduplicate candidates. A tool that matches no rule SHALL be neither advertised to the model nor executed if requested.

Exact and namespace MCP entries SHALL grant eligibility only to exact identities learned from safely admitted declarations for that server. When a live process loses the server transport, the last completely admitted identity set SHALL remain source inventory in an unavailable state; when complete discovery succeeds, its newly admitted identity set SHALL replace the prior set authoritatively. Neither permission form SHALL fabricate identities before first successful discovery or expose refused declarations. An eligible dynamic tool SHALL become advertisable or executable only while the source supplies a currently admitted declaration for that exact id under the operator's read-only attestation.

The restart-applied allowlist decision SHALL be bound into the immutable Run snapshot as filtered exact ids and exact declarations when a turn is accepted; wildcard patterns SHALL NOT enter provider requests, manifests, receipts, persistence, or execution binding. Removing an exact entry or namespace wildcard from later instance configuration SHALL affect newly accepted Runs but SHALL NOT retroactively rebind an already accepted Run or its queue retries. Immediate live revocation is outside this capability and requires the future permission-policy system; this bound authorization is permitted here only because every admitted remote tool is operator-attested read-only. Write-capable MCP tools remain prohibited even when they claim idempotence. The exact first-party Knowledge write tools additionally require their snapshotted declaration, durable recovery support, and current owner/view authorization. Managed publication enablement is checked live at preparation and before the accepted-state transition; an immutable tool declaration cannot preserve a revoked resource grant.

#### Scenario: Default is no tools

- **WHEN** the operator config does not set `tools.allowed`
- **THEN** runs never advertise or execute any tool

#### Scenario: Unlisted tool is not advertised

- **WHEN** a registered code-owned tool or discovered dynamic tool matches neither an exact entry nor an MCP namespace wildcard
- **THEN** it does not appear in the toolset offered to the model

#### Scenario: Unlisted tool is refused

- **WHEN** the model requests a tool that matches neither an exact entry nor an MCP namespace wildcard bound into the Run
- **THEN** the call is refused with a recorded, non-fatal tool error and the run continues

#### Scenario: Unknown tool id in the allowlist fails boot

- **WHEN** `tools.allowed` names an entry that is neither registered in code, a canonical exact dynamic id for a configured source, nor the canonical wildcard for a configured MCP namespace
- **THEN** startup fails naming the offending config path and id

#### Scenario: Eligible dynamic tool can remain unavailable

- **WHEN** a previously admitted MCP identity still matches an exact or namespace permission but its live process loses the server transport
- **THEN** unrelated Runs remain usable and the filtered identity is recorded as unavailable
- **AND** that tool is not advertised or executable for newly bound Runs

#### Scenario: Permission does not create a fresh-offline identity

- **WHEN** a fresh process has no admitted or remembered MCP inventory and `tools.allowed` names an exact id or namespace from that server
- **THEN** the permission produces no effective-context or availability-manifest entry

#### Scenario: Complete discovery removes omitted identities

- **WHEN** successful complete discovery omits or refuses a previously admitted exact identity
- **THEN** the new source inventory no longer contains that identity
- **AND** the next Run treats it as absent even when an exact or namespace permission would match it

#### Scenario: Namespace wildcard admits future exact ids

- **WHEN** a configured MCP server later supplies a safely admitted canonical tool id within its allowlisted namespace
- **THEN** the next Run may bind and advertise that exact id without an instance-config change
- **AND** no wildcard pattern appears in the Run snapshot or provider request

#### Scenario: Overlapping rules filter one inventory candidate once

- **WHEN** one exact MCP id is selected by both its exact entry and its server namespace wildcard
- **THEN** filtering retains the original inventory candidate once without creating another candidate

#### Scenario: Permission filtering does not hide source collisions

- **WHEN** distinct source candidates collide and both match one or more permission rules
- **THEN** both candidates reach the existing collision refusal unchanged rather than being deduplicated by permission matching

#### Scenario: Later allowlist removal does not rebind an accepted Run

- **WHEN** an exact entry or matching namespace wildcard is removed from restart-applied configuration after a Run accepted and snapshotted the filtered exact tool
- **THEN** that Run and its retries retain the bound authorization and declaration
- **AND** newly accepted Runs no longer advertise or execute the removed permission's unmatched tools

#### Scenario: Queue retry may repeat only a remote read

- **WHEN** a queue retry restarts a Run before a prior MCP call result was durably settled
- **THEN** the operator-attested read-only call may execute again
- **AND** no write-capable MCP operation is eligible under this capability

### Requirement: Tool retries reconcile Knowledge effects before model execution

Read-only Runs SHALL retain the existing restart-from-first-step behavior while
claimable. A Run with a prepared Knowledge publication intent SHALL reconcile
that intent before another model call; it SHALL NOT regenerate a canonical
mutation. An accepted publication SHALL restore its recorded bounded observation
and fence further canonical effects. An unresolved intent SHALL produce an honest
recovery-pending outcome. Before any publication intent exists, an interrupted
draft-only view SHALL be fenced and discarded before a fresh attempt; the restart
SHALL be narrated, and prior observations SHALL remain historical. This change
SHALL NOT add generic model-loop checkpointing or retry arbitrary shell commands.
Client reconnect SHALL continue replaying durable events without tool execution.
A terminal Run SHALL never be reopened merely to recover a Knowledge receipt;
owner-scoped recovery SHALL reconcile the existing effect separately.

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps and the run is expired by the deadman
- **THEN** the run terminates per existing semantics; no partial tool-loop state is resumed on a new run

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects to a live run after tool steps have completed
- **THEN** the replayed stream reconstructs those steps from events without executing any tool again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** a read-only Run's job is retried by the queue and the Run is still claimable
- **THEN** its tool loop executes from the first step again, re-invoking tools already invoked in the previous attempt

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** a job is retried for a run that has already reached a terminal state
- **THEN** the run is not reopened, no tool executes, and its terminal state stands

#### Scenario: Retry observes a prepared or accepted write

- **WHEN** a claimable Run is retried after allocating its Knowledge publication slot
- **THEN** the recorded intent is reconciled before any model execution
- **AND** a new tool-call identifier cannot allocate another slot or duplicate its commit
