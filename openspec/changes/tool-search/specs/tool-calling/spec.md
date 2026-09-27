## ADDED Requirements

### Requirement: Admitted MCP tools beyond the declaration budget are discoverable

Each execution attempt SHALL partition its admitted catalog after the existing availability gate.
MCP tools from operator servers and from the bound Workspace's servers SHALL be partitioned
alike. Every admitted code-owned tool, `search_tools` included, SHALL be declared to the model on
every step, SHALL NOT be discoverable, and SHALL NOT count against any budget. The attempt SHALL
estimate the eligible MCP declarations at four characters per token over each declaration's
canonical JSON. When `search_tools` is not admitted, or that estimate does not exceed the model's
declaration budget (`instance-config`), every admitted tool SHALL be declared and no tool SHALL be
discoverable.

When `search_tools` is admitted and the estimate exceeds the budget, deferral SHALL engage: the
attempt SHALL declare the longest prefix of the chat's
frozen MCP usage rank (`context-injection`), restricted to MCP tools admitted in this attempt,
whose declarations fit the budget together with the inventory estimate, and every other admitted
MCP tool SHALL be discoverable. An MCP tool absent from the rank SHALL NOT be declared while
deferral is engaged. The inventory estimate SHALL cover the ids and admitted descriptions of the
discoverable tools under every strategy. When the declared tier plus the inventory still exceed
the budget, discoverable tools SHALL be cut until it fits, unranked tools first in descending id
order and then ranked tools from the lowest rank up; a cut tool SHALL be recorded unavailable with the closed reason
`declaration_budget_exceeded` and SHALL NOT be declared, discoverable, searchable, or callable in
that attempt. Declared tools SHALL never be cut.

Tier membership SHALL NOT be availability: the availability comparison SHALL record declared and
discoverable tools identically, so a change of tier alone never produces an added or removed tool
reminder, while a cut SHALL appear as an unavailable transition with its reason. The rank SHALL
only select among admitted tools and SHALL NOT admit, authorize, or reclassify any tool.

#### Scenario: Catalog within budget changes nothing

- **WHEN** the eligible MCP declarations of an attempt fit its model's budget
- **THEN** every admitted tool is declared, `search_tools` included when admitted, and no tool is discoverable

#### Scenario: Deferral is off without an admitted tool search

- **WHEN** an attempt's MCP catalog exceeds the budget and `tools.allowed` does not list `search_tools`
- **THEN** every admitted tool is declared, as without this requirement

#### Scenario: Code-owned tools stay declared beyond the budget

- **WHEN** `search_tools` is admitted and an attempt's MCP catalog exceeds the budget
- **THEN** every admitted code-owned tool is declared on every step
- **AND** none of them is discoverable or counted against the budget

#### Scenario: Most-used MCP tools are declared

- **WHEN** `search_tools` is admitted, an attempt's MCP catalog exceeds the budget, and the chat's rank lists three admitted MCP tools whose declarations and the inventory fit the budget
- **THEN** those three are declared on every step of the attempt
- **AND** every other admitted MCP tool is discoverable

#### Scenario: The declared tier is a strict prefix of the rank

- **WHEN** deferral is engaged and the second-ranked tool's declaration would exceed the remaining budget but the third-ranked tool's would fit
- **THEN** only the first-ranked tool is declared
- **AND** the second- and third-ranked tools are discoverable

#### Scenario: Unused tools are never pre-declared

- **WHEN** `search_tools` is admitted, an owner has no recorded successful MCP call, and the catalog exceeds the budget
- **THEN** no MCP tool is declared and every admitted MCP tool is discoverable

#### Scenario: A ranked tool that is no longer admitted is skipped

- **WHEN** deferral is engaged and the chat's rank lists a tool the current attempt did not admit
- **THEN** that tool is neither declared nor discoverable and the next ranked admitted tool is considered

#### Scenario: Inventory alone exceeds the budget

- **WHEN** deferral is engaged and the declared tier plus the inventory of every discoverable tool exceed the budget
- **THEN** discoverable tools are cut until it fits, unranked ones first in descending id order, then ranked ones from the lowest rank up
- **AND** each cut tool is recorded unavailable with reason `declaration_budget_exceeded`
- **AND** the availability reminder discloses the cut on the next turn

#### Scenario: Crossing the threshold emits no availability reminder

- **WHEN** `search_tools` is admitted and a catalog grows past the budget without any tool becoming unavailable
- **THEN** no added or removed tool reminder is produced by the change of tier

### Requirement: Tool search loads discoverable tools

`search_tools` SHALL be a code-owned tool classified `read_only` and needing no tenant database
access. Like every code-owned tool it SHALL require its own exact `tools.allowed` entry, and every
call SHALL be evaluated against its own `tools.permissions` group; an absent group SHALL reject
the call. When admitted, it SHALL be declared on every step until the step cap is reached, whether
or not anything is discoverable. Its input SHALL be `{ select?: string[], query?: string, limit?:
integer }` with at least one of `select` and `query`; a call with neither SHALL be refused as
`invalid_input`. `select` SHALL accept any string in the `mcp-tool-id-v1` grammar (`mcp-tools`)
and SHALL resolve exact discoverable ids. When both are given, `select` SHALL resolve first and
`query` SHALL fill the result up to `limit`. `query` SHALL match case-insensitive tokens against each discoverable id split
on `_` and `-` and against its neutralized description, ranking an exact id match, then an id
token match, then a description token match, and breaking ties by the chat's usage rank and then
by id. `limit` SHALL default to 5 with a maximum of 20 and SHALL bound the total loaded; `select`
SHALL accept at most 20 ids.
Only the attempt's discoverable tools SHALL be candidates. The stored result SHALL be
`{ status: 'success', loaded: [ids], notFound: [ids] }` and SHALL NOT contain declarations.

A discoverable tool SHALL be loaded for a model request if and only if that request's projected
context carries the result body of a `search_tools` observation that loaded it, or an earlier step
of the same Run loaded it. A pair the replay budget omitted or cleared, and a compaction
replacement record, SHALL NOT count as a load. Every tool a request
declares, whether declared by tier or loaded, SHALL use the current attempt's admitted
declaration; a loaded id that is no longer admitted SHALL NOT be declared, referenced, or
callable. llame's execute wrapper SHALL refuse a call to a discoverable tool that is not loaded for
the current request with the recorded `not_available` outcome before any executor runs.

Every call to a tool that `search_tools` loaded SHALL be evaluated against that tool's own
permission group. A step whose only calls are `search_tools` SHALL count toward `maxStepsPerRun`.

#### Scenario: Exact select loads a tool

- **WHEN** the model calls `search_tools` with `select` naming two discoverable ids
- **THEN** the result lists both under `loaded`
- **AND** both are callable on the following step of the Run

#### Scenario: Keyword query ranks deterministically

- **WHEN** two discoverable tools match a query only through their descriptions
- **THEN** the higher-ranked tool in the chat's usage rank is listed first, and unranked ties are ordered by id

#### Scenario: Search cannot surface a tool outside the discoverable tier

- **WHEN** the model searches for a declared tool, a cut tool, an unavailable tool, or an id that is not admitted
- **THEN** that id is never listed under `loaded`
- **AND** an explicitly selected one is listed under `notFound`

#### Scenario: Unloaded discoverable tool is refused

- **WHEN** the model calls a discoverable tool that no visible `search_tools` observation loaded
- **THEN** the call is recorded with the `not_available` outcome and no executor runs

#### Scenario: A load carries into the next Run

- **WHEN** a Run loaded a tool and the next Run's model context still contains that observation
- **THEN** the tool is callable in the next Run without another search

#### Scenario: Compaction ends a load

- **WHEN** compaction absorbs the observation that loaded a tool into a checkpoint
- **THEN** the tool is no longer loaded and a call to it is refused until the model searches again

#### Scenario: A dropped observation ends a load

- **WHEN** the replay budget omits the oldest `search_tools` pair from a request, or clears it to its call and outcome
- **THEN** the tools only that pair loaded are not callable on that request

#### Scenario: Queue retry starts without the failed attempt's loads

- **WHEN** an attempt loads a tool and then fails without having recorded an MCP dispatch or native attempt, and the queue retries the Run
- **THEN** the retry's first request treats that tool as not loaded
- **AND** a call to it on the retry is refused until the retry loads it

#### Scenario: A revoked tool is not resurrected by history

- **WHEN** a tool loaded in an earlier Run is no longer admitted in the current attempt
- **THEN** it is not declared, referenced, or callable, whatever the replayed history contains

#### Scenario: Tool search counts toward the step cap

- **WHEN** the step cap is reached on a step that only called `search_tools`
- **THEN** no further tool executes and the model is driven to answer

#### Scenario: A loaded tool still needs its own permission group

- **WHEN** `tools.permissions` has no group for a discoverable MCP tool and the model loads it through `search_tools`
- **THEN** the search succeeds and lists the tool under `loaded`
- **AND** a call to that tool is rejected as `permission_denied`

#### Scenario: Tool search without a permission group is rejected

- **WHEN** deferral is engaged and `tools.permissions` has no `search_tools` group
- **THEN** each `search_tools` call is rejected as `permission_denied` and loads nothing

#### Scenario: A search with neither select nor query is refused

- **WHEN** the model calls `search_tools` with neither `select` nor `query`
- **THEN** the call is refused as `invalid_input` and loads nothing

#### Scenario: Select and query share one limit

- **WHEN** the model calls `search_tools` with `select` naming two discoverable ids, a `query` matching five others, and `limit` 4
- **THEN** the two selected ids and the two best query matches are listed under `loaded`

### Requirement: In-Run Workspace additions join the tool partition

When a trusted Workspace entry adds MCP declarations to an active attempt, the attempt SHALL add
their estimate to its running MCP estimate. If `search_tools` is not admitted, or deferral is not
engaged and the total fits the budget, the additions SHALL be declared. Otherwise deferral SHALL
be engaged for the rest of the attempt: tools already declared SHALL stay declared, the additions
present in the chat's usage rank SHALL be declared in rank order while they fit the remaining
budget as a strict prefix, and every other addition SHALL be discoverable. `search_tools` is
already declared whenever it is admitted, so no declaration other than a Workspace addition SHALL
be inserted during a Run. Additions SHALL never be cut. A discoverable addition SHALL be added to the attempt's tool record
without being offered to the model under `harness`, and with the adapter's deferred-loading
option under `native`. An addition whose executor becomes unavailable through exit, switch, or
detach SHALL stop being a `search_tools` candidate. The next attempt SHALL partition the bound
Workspace's tools at its start like every other admitted MCP tool.

#### Scenario: A small addition within budget is declared

- **WHEN** a Run whose MCP catalog fits its budget enters a Workspace whose admitted tools still fit
- **THEN** the added tools are declared from the next step and none is discoverable

#### Scenario: A large addition engages deferral mid-Run

- **WHEN** `search_tools` is admitted and a Run whose MCP catalog fits its budget enters a Workspace whose admitted tools would exceed it
- **THEN** the tools declared before entry stay declared
- **AND** ranked additions are declared while they fit, and the other additions are discoverable
- **AND** the entry result lists each discoverable addition by id

#### Scenario: A discoverable addition is selectable by id

- **WHEN** the model calls `search_tools` with `select` naming an id that became discoverable after `search_tools` was declared
- **THEN** the call passes schema validation and the id is listed under `loaded`

#### Scenario: Exit withdraws a discoverable addition from search

- **WHEN** a Workspace exit makes a discoverable addition's executor unavailable
- **THEN** `search_tools` no longer lists or loads it, and a call to it is refused as unavailable

### Requirement: Discoverable tools count as callable for availability disclosure

For the availability comparison and reminder, a discoverable tool SHALL be `available` and SHALL
count as callable in the current Run, because one `search_tools` call makes it callable, and its
native advertisement is the `search_tools` inventory or its deferred declaration. A tool that
becomes discoverable after being absent MAY therefore appear under `Added tools`. `search_tools`
SHALL be recorded like any other admitted code-owned tool.

#### Scenario: A newly admitted MCP tool lands in the discoverable tier

- **WHEN** a new MCP tool is admitted on a later turn while deferral is engaged and it is not in the rank
- **THEN** the availability reminder lists it under `Added tools`
- **AND** a call to it before a search is refused as `not_available`, while a search loads it

### Requirement: Tool-search delivery is a per-model strategy

The model's `toolSearch` strategy (`instance-config`) SHALL decide only how declared and loaded
schemas reach the model. Partitioning, the rank, `search_tools` execution, the loaded-set rule, and
the call gate SHALL be identical under every strategy, so one catalog partitions identically
under both.

Under `harness`, discoverable tools SHALL be omitted from the request, and each step's declared
set SHALL be the declared tier, which includes `search_tools`, plus the loaded tools, or empty
once the step cap is reached. A `search_tools` observation SHALL reach the model through the
ordinary tool observation projection, listing its `loaded` and `notFound` ids.

Under `native` on `anthropic-messages`, every admitted tool SHALL be sent, discoverable tools with
the adapter's deferred-loading option and every other tool without it. A `search_tools` result
SHALL reach the model, within its Run and on replay, as a tool result whose content is one text
line summarizing the result followed by one tool reference per loaded id present in that
request's tools. llame SHALL author no block-level cache marker.

Under `native` on `openai-responses`, discoverable functions SHALL be sent with the adapter's
deferred-loading option, `search_tools` SHALL be bound as the provider's client-executed tool
search without an id enumeration, and a `search_tools` result SHALL reach the model, within its
Run and on replay, as the provider's tool-search call and client tool-search output carrying the
current attempt's declarations of the loaded ids present in that request's tools. The provider's
`{ arguments, call_id }` input SHALL be unwrapped before the call is recorded, so the stored
input is always the wire-neutral shape.

Under `harness` and under `native` on `anthropic-messages`, the `select` items SHALL disclose the
ids discoverable at the attempt's start as an enumeration alongside the `mcp-tool-id-v1` string
form, and SHALL carry only the string form when nothing is discoverable at the start; under
`native` on `openai-responses` they SHALL carry no enumeration.

Under `native`, reaching the step cap SHALL keep the request's tools and set the tool choice to
none instead of removing every tool. Under every strategy, the context-window fit check SHALL
measure the tools the request actually sends, and post-turn compaction SHALL send the same tools,
with the same deferred-loading options, as the Run's last model request.

The `native` projections SHALL apply only to `search_tools` pairs projected with their result
body, and only in a request that carries the attempt's native tool set; every other request,
including transition compaction, and every cleared or replacement record SHALL use the ordinary
text projection. The stored part SHALL stay the wire-neutral result, so the same observation
SHALL replay in the executing model's form after a model switch, including as ordinary text
under `harness`. Within one chat epoch on a `native`
model whose admitted catalog does not change, loading a tool SHALL NOT change the request's tools.

#### Scenario: Same catalog partitions identically under both strategies

- **WHEN** the same admitted catalog, rank, and budget are resolved for a `harness` model and a `native` model
- **THEN** both attempts declare the same MCP tools and make the same tools discoverable

#### Scenario: Harness declares a loaded tool on later steps

- **WHEN** a `harness` model loads a tool through `search_tools`
- **THEN** the following steps' requests declare that tool with its current admitted schema
- **AND** the next Run's first request declares it while the loading observation is still visible

#### Scenario: Anthropic native keeps the tools array constant

- **WHEN** a `native` `anthropic-messages` model loads a tool in one Run and calls it in the next
- **THEN** both Runs send the same tools, with the loaded tool still marked deferred
- **AND** the loading result carries a tool reference for that tool in both Runs

#### Scenario: Anthropic native omits references to tools not in the request

- **WHEN** a replayed `search_tools` observation loaded a tool the current attempt does not admit, or cuts
- **THEN** its projected result carries no tool reference for that id

#### Scenario: The native step cap keeps the tools

- **WHEN** a `native` `anthropic-messages` Run reaches the step cap after loading a tool
- **THEN** the cap request still carries every tool it sent before, with the tool choice set to none
- **AND** the request is accepted and the model answers without calling a tool

#### Scenario: Transition compaction projects loads as text

- **WHEN** a chat switches away from a `native` `anthropic-messages` model after a load and transition compaction runs without tools
- **THEN** the compaction request projects the `search_tools` observation as ordinary text with no tool reference

#### Scenario: The fit check measures delivered tools

- **WHEN** deferral is engaged under `harness` and the admitted MCP catalog alone would exceed the context window
- **THEN** the fit check counts only the declared tier, `search_tools`, and loaded tools, and the request proceeds

#### Scenario: OpenAI native replays a load as provider items

- **WHEN** a `native` `openai-responses` model loaded a tool in an earlier Run
- **THEN** the replayed request carries a tool-search call and a client tool-search output holding that tool's current declaration
- **AND** the deferred function stays in the request's tools

#### Scenario: A model switch replays the load in the new wire's form

- **WHEN** a chat switches from a `native` model to a `harness` model after a load
- **THEN** the observation replays as ordinary text listing the loaded ids and the loaded tool is declared on the harness request

## MODIFIED Requirements

### Requirement: Tool observations survive into later turns as stored UI parts

The prospective cutover boundary in `context-injection` SHALL govern failed-attempt retention; existing conversation state SHALL not be retrospectively filtered or rebuilt. A failed, cancelled, expired, or superseded attempt keeps its partial output and context as the user saw them, and that record participates in later model context and compaction like any other committed turn. An individual failed tool call within a successfully committed attempt SHALL still retain its normal paired failure observation.

A round's tool activity SHALL remain available to the model in later turns
within the bounded replay contract below. What a tool was asked and what it
returned or failed to return SHALL be representable on the next turn unless an
older complete observation must be omitted to enforce the hard budget.

Each replayed observation SHALL carry tool identity, input while its payload
fits, and structured outcome. Calls refused, cancelled, timed out, unavailable,
execution-failed, search-failed, or otherwise errored SHALL retain that outcome
rather than disappearing. Legacy output-error parts without structured outcome
SHALL map to generic `error` without parsing human prose; structured
cancellation metadata MAY recover `cancelled`.

Ordinary stored assistant parts SHALL replay through the existing conventional
AI SDK tool-call/tool-result projection until #599 establishes the canonical UI
message persistence contract. Every projected call SHALL be accompanied by its
matching result, including a well-formed result for a call with no genuine tool
result. Credentials and unrelated payloads SHALL NOT replay, and the tool
projection SHALL NOT carry provider-native reasoning or metadata; persisted
reasoning parts and their provider metadata reach the provider only through
`reasoning-output`'s same-Chat replay, outside this projection and its budget.

The ordinary projection SHALL remain:

- portable through SDK tool-call and tool-result parts rather than
  provider-specific structures;
- labelled untrusted inside result content;
- neutralized so remote-authored result content cannot forge a reserved
  structural boundary;
- bounded in JavaScript UTF-16 code units over the exact serialized pair, at
  8,000 per pair and 32,000 per stored assistant turn;
- reduced by preserving pairing before budget, newer observations before older
  ones, and identity/outcome before payload; and
- stable for the same unmodified stored turn under the current explicit
  best-effort projector.

One exception applies to `search_tools` observations (`tool-calling` "Tool-search delivery is a
per-model strategy"). A `search_tools` pair kept with its result body, in a request that carries
the attempt's native tool set of a `native` model, SHALL project in that wire's loading form: a
tool result of one framed text line plus provider tool references on `anthropic-messages`, and
the provider's tool-search call and client tool-search output on `openai-responses`. Its pairing,
budget accounting, clearing, omission, and ordering SHALL be those of the ordinary projection,
and it SHALL fall back to the ordinary projection whenever either condition fails.

Payloads SHALL clear oldest-first only when clearing shrinks the envelope. If
irreducible pairs still exceed a limit, the oldest complete pairs SHALL be
dropped atomically until the projection fits, with one bounded omission count
and marker. An unmatched call or result SHALL never be emitted.

Visible assistant text and retained tool occurrences SHALL keep their current
chronology. Because ordinary stored messages do not prove parallel or step
boundaries, consecutive calls SHALL continue to project conservatively as
standalone sequential matched pairs. This behavior SHALL NOT be generalized or
rewritten by this change; its research/refactor is scoped by #599.

Compaction SHALL replace the semantic observation ledger with final
message-shaped replacement records. Ordinary and transition compaction SHALL:

1. correlate complete stored call/result observations by `toolCallId`;
2. combine them with tool records from the previous replacement history;
3. enforce the same complete-pair selection, per-pair limit, total 32,000-unit
   budget, newer-pair preference, payload clearing, outcome preservation, and
   bounded omission count; and
4. persist the selected final AI SDK UI `tool-*` parts in replacement history,
   with one complete pair per assistant replacement record and any omission
   marker in its own assistant text record.

The stored final replacement parts SHALL be the sole authority after compaction.
Model replay and cache-aligned compaction input SHALL order the user checkpoint
record first, the stored compacted tool records second, and the retained live
window last. Replay SHALL NOT regenerate tool parts from semantic fields,
re-clear payloads, recompute budgets, or reorder records. A later compaction MAY
materialize a new bounded replacement and omit older complete records, but it
SHALL consume the prior stored records rather than a ledger.

Replacement history SHALL remain RLS-scoped internal state and SHALL NOT enter
public DTOs, search indexes, or ordinary exports. No legacy ledger reader,
empty-ledger sentinel, or inference from summary prose SHALL exist.

The live tool loop SHALL continue to observe its own results within the turn
that produced them.

#### Scenario: A later turn can use an earlier tool result

- **WHEN** a tool returns a result and the user asks about it later
- **THEN** the later request carries its identity, input when retained, result,
  and outcome through the conventional SDK representation

#### Scenario: An unsuccessful call is projected as unsuccessful

- **WHEN** a prior call was refused, cancelled, errored, or timed out
- **THEN** later replay carries a matched result reporting that outcome
- **AND** the call is not silently omitted solely because it failed

#### Scenario: A cancelled call is projected as cancelled

- **WHEN** a prior call was settled by unsuccessful Run termination
- **THEN** operational/UI replay reports its matching `cancelled` result, and that failed attempt's persisted output remains part of model history like any other committed turn
- **AND** it remains distinguishable from a tool-produced error

#### Scenario: A tool call made during reasoning is projected

- **WHEN** a tool was called while reasoning output was produced
- **THEN** the call/result observation follows the same replay contract
- **AND** the reasoning part is not carried by the tool projection; it replays
  under `reasoning-output` in its own occurrence position

#### Scenario: Every replayed call has a matching replayed result

- **WHEN** a later request replays stored tool activity
- **THEN** every retained call is immediately paired with its result
- **AND** unmatched calls/results are omitted atomically

#### Scenario: A call with no genuine result still carries a well-formed result

- **WHEN** a call was cancelled, refused, errored, or timed out before a genuine
  tool result existed
- **THEN** replay supplies a well-formed result carrying that outcome
- **AND** it does not narrate the absence as unrelated assistant prose

#### Scenario: Provider reasoning and metadata are never replayed

- **WHEN** stored tool activity includes reasoning or provider metadata
- **THEN** portable observations remain available across model/provider switches
- **AND** the tool projection carries no originating-provider reasoning or
  metadata; reasoning replay is governed by `reasoning-output`

#### Scenario: A model or provider switch keeps observations but not provider metadata

- **WHEN** a chat with tool activity continues on another model or provider
- **THEN** portable matched observations remain available through the target
  SDK conversion
- **AND** originating-provider metadata is excluded from the tool projection;
  replayed reasoning parts are passed back unchanged, `reasoning-output` omits
  before the request the ones the target wire cannot represent, and the target
  provider ignores or drops the rest

#### Scenario: The projection is labelled untrusted

- **WHEN** an ordinary or compacted tool result is replayed
- **THEN** its own result content identifies it as untrusted tool output
- **AND** instruction-like payload text carries no authority

#### Scenario: Replayed content cannot escape its boundary

- **WHEN** a tool result attempts to forge or close a reserved boundary
- **THEN** the replayed result is neutralized under the tool projection contract
- **AND** surrounding structure remains intact

#### Scenario: The projection is stable across turns

- **WHEN** the same unmodified ordinary stored tool part replays twice
- **THEN** the current projector produces the same application content
- **AND** final compacted UI parts replay directly from replacement history

#### Scenario: Interleaved text and tools retain chronology

- **WHEN** an assistant turn contains visible text, tool calls, and later text
- **THEN** the current projector retains their occurrence order as standalone
  text and sequential matched pairs
- **AND** the implementation points to #599 instead of claiming proven step
  boundaries

#### Scenario: Visible text does not consume the observation budget

- **WHEN** visible assistant text surrounds capped tool observations
- **THEN** visible text retains its occurrence order outside the observation
  budget
- **AND** it does not cause an otherwise-retained pair to be dropped

#### Scenario: Hard limits preserve pairing and newest observations

- **WHEN** a serialized pair or turn exceeds its hard limit
- **THEN** payloads clear only when useful, then oldest complete pairs are
  omitted until the result fits
- **AND** exactly one bounded omission marker is retained and call/result counts
  remain equal

#### Scenario: Compaction carries cleared observations across lineage

- **WHEN** ordinary or transition compaction absorbs tool activity
- **THEN** it writes already selected, bounded, payload-cleared final UI tool
  parts into replacement history
- **AND** the next request replays those stored records after the checkpoint and
  before live history without a tool-observation renderer

#### Scenario: Recursive compaction consumes replacement history

- **WHEN** a later compaction supersedes a prior compaction
- **THEN** it consumes prior stored replacement records plus newly absorbed
  observations
- **AND** it writes a wholly new bounded replacement rather than reconstructing
  or extending a semantic ledger

#### Scenario: Existing compactions cannot recover already-absorbed observations

- **WHEN** an active compaction lacks valid replacement history
- **THEN** request preparation fails closed
- **AND** no old ledger or summary prose is used to invent tool observations

#### Scenario: The live loop still observes its own tool results

- **WHEN** a tool executes during a Run
- **THEN** its result remains available within that same Run's tool loop

### Requirement: Framing llame authors inside tool results is a packaged template

The untrusted-output framing that wraps every tool result presented to a model, and each closed notice llame places inside a tool result (the prior-conversation notice of `conversation-reads`, the search-excerpt notice of `chat-search`, the Knowledge content notice of `knowledge-tools`, and the path instruction of `agent-skills`), SHALL be a packaged template file owned by the module that authors the text and shipped with the executing process, rendered under the producer-owned-values rule `context-injection` defines for item bodies. These templates SHALL NOT be operator configuration: no configuration key SHALL select, replace, or disable one. Rendered bytes SHALL be identical to the previous inline text, and the neutralization applied to a composed result today SHALL continue to apply to the rendered result.

Result content composed by a tool implementation, the permission layer, or result truncation (error messages, permission rejections, settlement and truncation notices) is not framing and remains outside this requirement.

A native `search_tools` projection (`tool-calling`) SHALL carry the framing on its text line where
the wire's loading form has one. Provider tool references and the client tool-search output carry
only admitted tool names and declarations that the request already sends as tool definitions, and
SHALL carry no framing.

#### Scenario: Wrapped tool output is unchanged by the template migration

- **WHEN** a tool result is presented to a model after this change
- **THEN** its untrusted-output framing, outcome line, and payload block are byte-identical to the previous inline composition
- **AND** the composed text is neutralized exactly as before

#### Scenario: A result notice is unchanged by the template migration

- **WHEN** a conversation read, search, Knowledge read, or skill read returns its closed notice after this change
- **THEN** the notice text is byte-identical to the previous inline constant
- **AND** the capability that owns the notice still observes its content obligations

#### Scenario: No configuration replaces a result notice

- **WHEN** an operator configuration attempts to name a replacement for a result notice or the output framing
- **THEN** startup rejects the unknown key under the closed schema
- **AND** the packaged template remains in use

### Requirement: Trusted in-Run tool additions are admitted and made unavailable with Workspace state

Only a trusted harness action entering a Workspace SHALL add tool declarations to the active
attempt; model output or an untrusted tool source SHALL NOT add declarations directly. Each
addition SHALL pass the same source admission, `tools.allowed`, safety-classification, and
schema-admission checks as declarations composed at attempt start, and each invocation SHALL
independently pass the executing process's `tools.permissions` policy. An admitted addition SHALL
become callable beginning with the next model step in that Run, unless `tool-calling`'s
partition makes it discoverable, in which case it SHALL become callable once a `search_tools`
call loads it. The active attempt's model-facing
declaration map and executable binding SHALL be updated in place. The declaration key SHALL never
be removed from that attempt during the Run. A Workspace exit, switch, or detach SHALL make the
corresponding executor unavailable while retaining its declaration; a later request for that id
SHALL be refused as unavailable, recorded as a non-fatal tool refusal, and SHALL NOT execute or
substitute a changed contract. Adding tools SHALL NOT reset, increase, or bypass the configured
tool-step cap.

If an entering Workspace server's id is byte-equal to an operator server id whose tools are already
declared in the active attempt, the Workspace server SHALL contribute no tools to that attempt. The
entry result SHALL identify those tools as "shadows from the next Run"; the operator declarations
SHALL retain their executors for the rest of that attempt. From the next attempt that composes the
live binding, including a retry attempt of the same Run, the started Workspace server SHALL shadow
the operator server under the same tool ids and exact-id permission groups.

If a Workspace server's id differs from an operator server id only by ASCII case, the Workspace
server SHALL be reported unavailable with reason "case-only collision with an operator server",
SHALL contribute no tools, and SHALL leave the operator tools unaffected.

When a trusted Workspace action re-adds an id already present in the active attempt, including after
exit then re-entry or a switch between roots defining that id, the new executor SHALL be bound only
when the newly admitted declaration is identical to the retained declaration as compared in memory;
nothing SHALL be persisted for that comparison. If the declarations differ, that id SHALL have no
executor in this attempt and the entry result SHALL report it as "available from the next Run".
Declarations SHALL never be replaced or removed within the attempt.

Tool availability SHALL be resolved at runtime rather than declared as a scheduling-time
restriction. At the start of each attempt, the Run SHALL compose current Workspace tools from the
live binding, and each active step SHALL use its current in-memory declarations. Added declarations
SHALL exist only in the active attempt's memory; nothing about them SHALL be persisted as a Run
record. A subsequent attempt for a Chat that remains entered, including a retry of the same Run,
SHALL resolve current Workspace declarations from the live binding at its start, independent of
prior attempt or Run state.

#### Scenario: Workspace entry makes an admitted tool callable on the next step

- **WHEN** a trusted harness action enters a Workspace during a Run and its MCP source supplies a declaration that passes the same admission checks used at attempt composition
- **THEN** the declaration is added to the active tool set and can be called beginning with the next model step
- **AND** calls remain subject to the executing process's `tools.permissions` policy
- **AND** the addition does not reset, increase, or bypass the configured tool-step cap

#### Scenario: Workspace exit or switch removes an added tool executor

- **WHEN** a Workspace exit, switch, or detach makes an MCP declaration that was added during the active Run unavailable and the model later requests that id
- **THEN** the declaration remains in the attempt-local tool set with an unavailable executor, and the call is refused as unavailable without executing or substituting a changed contract
- **AND** the refusal is recorded and non-fatal to the Run

#### Scenario: Subsequent attempt composes active Workspace tools from its start

- **WHEN** a subsequent attempt starts for a Chat that remains entered, including a retry of the same
  Run, and a Workspace MCP declaration is currently admitted
- **THEN** the declaration is in the attempt's tool set before the first model step
- **AND** the attempt resolves it from the live Workspace binding rather than from prior Run state

#### Scenario: Mid-Run Workspace shadowing is deferred

- **WHEN** an entering Workspace server's id is byte-equal to an operator server id whose tools are already declared in the active attempt
- **THEN** the Workspace server contributes no tools in that attempt, the entry result reports "shadows from the next Run", and the operator tools keep their executors
- **AND** the next attempt, including a retry of the same Run, uses the started Workspace server under the same tool ids and exact-id permission groups without collision-refusing the operator tools

#### Scenario: ASCII-case-only Workspace server collision is unavailable

- **WHEN** an entering Workspace server's id differs from an operator server id only by ASCII case
- **THEN** the Workspace server is reported unavailable with reason "case-only collision with an operator server", contributes no tools, and leaves the operator tools unaffected

#### Scenario: Re-adding a retained declaration requires an identical declaration

- **WHEN** a trusted Workspace action exits and re-enters, or switches between roots, and the new source admits an id already present in the active attempt
- **THEN** the new executor is bound only when the newly admitted declaration is identical to the retained declaration as compared in memory
- **AND** if the declaration differs, that id has no executor in this attempt and the entry result reports it as "available from the next Run"
- **AND** the retained declaration key is neither replaced nor removed
