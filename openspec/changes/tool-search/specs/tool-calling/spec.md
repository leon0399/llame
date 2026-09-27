## ADDED Requirements

### Requirement: Admitted MCP tools beyond the declaration budget are discoverable

Each execution attempt SHALL partition its admitted catalog after the existing availability gate.
Every admitted code-owned tool SHALL be declared to the model on every step and SHALL NOT count
against any budget. The attempt SHALL estimate the eligible MCP declarations at four characters
per token over each declaration's canonical JSON; when that estimate does not exceed the model's
declaration budget (`instance-config`), every admitted tool SHALL be declared and the request's
tools SHALL be identical to those sent without this requirement.

When the estimate exceeds the budget, the attempt SHALL declare the longest prefix of the chat's
frozen MCP usage rank (`context-injection`), restricted to MCP tools admitted in this attempt,
whose declarations fit the budget together with the inventory estimate, and every other admitted
MCP tool SHALL be discoverable. An MCP tool absent from the rank SHALL NOT be declared while
deferral is engaged. The inventory estimate SHALL cover the ids and admitted descriptions of the
discoverable tools under every strategy. When the declared tier plus the inventory still exceed
the budget, discoverable tools SHALL be cut, lowest-ranked first and then by descending id among
unranked tools, until it fits; a cut tool SHALL be recorded unavailable with the closed reason
`declaration_budget_exceeded` and SHALL NOT be declared, discoverable, searchable, or callable in
that attempt. Declared tools SHALL never be cut.

Tier membership SHALL NOT be availability: the availability comparison SHALL record declared and
discoverable tools identically, so a change of tier alone never produces an added or removed tool
reminder, while a cut SHALL appear as an unavailable transition with its reason. The rank SHALL
only select among admitted tools and SHALL NOT admit, authorize, or reclassify any tool.

#### Scenario: Catalog within budget changes nothing

- **WHEN** the eligible MCP declarations of an attempt fit its model's budget
- **THEN** every admitted tool is declared and no `tool_search` is synthesized
- **AND** the provider request's tools are the same as without this requirement

#### Scenario: Code-owned tools stay declared beyond the budget

- **WHEN** an attempt's MCP catalog exceeds the budget
- **THEN** every admitted code-owned tool is declared on every step
- **AND** none of them is discoverable or counted against the budget

#### Scenario: Most-used MCP tools are declared

- **WHEN** an attempt's MCP catalog exceeds the budget and the chat's rank lists three admitted MCP tools whose declarations and the inventory fit the budget
- **THEN** those three are declared on every step of the attempt
- **AND** every other admitted MCP tool is discoverable

#### Scenario: The declared tier is a strict prefix of the rank

- **WHEN** the second-ranked tool's declaration would exceed the remaining budget but the third-ranked tool's would fit
- **THEN** only the first-ranked tool is declared
- **AND** the second- and third-ranked tools are discoverable

#### Scenario: Unused tools are never pre-declared

- **WHEN** an owner has no recorded successful MCP call and the catalog exceeds the budget
- **THEN** no MCP tool is declared and every admitted MCP tool is discoverable

#### Scenario: A ranked tool that is no longer admitted is skipped

- **WHEN** the chat's rank lists a tool the current attempt did not admit
- **THEN** that tool is neither declared nor discoverable and the next ranked admitted tool is considered

#### Scenario: Inventory alone exceeds the budget

- **WHEN** the declared tier plus the inventory of every discoverable tool exceed the budget
- **THEN** discoverable tools are cut lowest-ranked first, then by descending id, until it fits
- **AND** each cut tool is recorded unavailable with reason `declaration_budget_exceeded`
- **AND** the availability reminder discloses the cut on the next turn

#### Scenario: Crossing the threshold emits no availability reminder

- **WHEN** a catalog grows past the budget without any tool becoming unavailable
- **THEN** no added or removed tool reminder is produced by the change of tier

### Requirement: Tool search loads discoverable tools

When an attempt has at least one discoverable tool, it SHALL synthesize the reserved tool
`tool_search`, classified `read_only`, needing no tenant database access, absent from the
availability manifest, and declared on every step until the step cap is reached. Its input SHALL
be `{ select?: string[], query?: string, limit?: integer }`. `select` SHALL resolve exact
discoverable ids. `query` SHALL match case-insensitive tokens against each discoverable id split
on `_` and `-` and against its neutralized description, ranking an exact id match, then an id
token match, then a description token match, and breaking ties by the chat's usage rank and then
by id. `limit` SHALL default to 5 with a maximum of 20; `select` SHALL accept at most 20 ids.
Only the attempt's discoverable tools SHALL be candidates. The stored result SHALL be
`{ status: 'success', loaded: [ids], notFound: [ids] }` and SHALL NOT contain declarations.

A discoverable tool SHALL be loaded for a model request if and only if that request's model
context contains a `tool_search` observation that loaded it, after compaction replacement and
after the replay budget, or an earlier step of the same Run loaded it. Every tool a request
declares, whether declared by tier or loaded, SHALL use the current attempt's admitted
declaration; a loaded id that is no longer admitted SHALL NOT be declared, referenced, or
callable. llame's execute wrapper SHALL refuse a call to a discoverable tool that is not loaded for
the current request with the recorded `not_available` outcome before any executor runs.

The registry SHALL refuse to register `tool_search`, and `tools.allowed` validation SHALL fail
startup if it lists `tool_search`. A step whose only calls are `tool_search` SHALL count toward
`maxStepsPerRun`.

#### Scenario: Exact select loads a tool

- **WHEN** the model calls `tool_search` with `select` naming two discoverable ids
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

- **WHEN** the model calls a discoverable tool that no visible `tool_search` observation loaded
- **THEN** the call is recorded with the `not_available` outcome and no executor runs

#### Scenario: A load carries into the next Run

- **WHEN** a Run loaded a tool and the next Run's model context still contains that observation
- **THEN** the tool is callable in the next Run without another search

#### Scenario: Compaction ends a load

- **WHEN** compaction absorbs the observation that loaded a tool into a checkpoint
- **THEN** the tool is no longer loaded and a call to it is refused until the model searches again

#### Scenario: A dropped observation ends a load

- **WHEN** the replay budget omits the oldest `tool_search` pair from a request
- **THEN** the tools only that pair loaded are not callable on that request

#### Scenario: Queue retry starts without the failed attempt's loads

- **WHEN** an attempt loads a tool and then fails, and the queue retries the Run
- **THEN** the retry's first request treats that tool as not loaded
- **AND** a call to it on the retry is refused until the retry loads it

#### Scenario: A revoked tool is not resurrected by history

- **WHEN** a tool loaded in an earlier Run is no longer admitted in the current attempt
- **THEN** it is not declared, referenced, or callable, whatever the replayed history contains

#### Scenario: Tool search counts toward the step cap

- **WHEN** the step cap is reached on a step that only called `tool_search`
- **THEN** no further tool executes and the model is driven to answer

#### Scenario: Reserved id cannot be registered or allowlisted

- **WHEN** code registers a tool named `tool_search`, or `tools.allowed` lists it
- **THEN** registration fails, or startup fails naming `tools.allowed`

### Requirement: Tool-search delivery is a per-model strategy

The model's `toolSearch` strategy (`instance-config`) SHALL decide only how declared and loaded
schemas reach the model. Partitioning, the rank, `tool_search` execution, the loaded-set rule, and
the call gate SHALL be identical under every strategy, so one catalog partitions identically
under both.

Under `harness`, discoverable tools SHALL be omitted from the request, and each step's declared
set SHALL be the declared tier plus the loaded tools plus `tool_search`, or empty once the step
cap is reached. A `tool_search` observation SHALL reach the model through the ordinary tool
observation projection, listing its `loaded` and `notFound` ids.

Under `native` on `anthropic-messages`, every admitted tool SHALL be sent, discoverable tools with
the adapter's deferred-loading option and every other tool without it. A `tool_search` result
SHALL reach the model, within its Run and on replay, as a tool result whose content is one text
line summarizing the result followed by one tool reference per loaded id that the current attempt
admits. llame SHALL author no block-level cache marker.

Under `native` on `openai-responses`, discoverable functions SHALL be sent with the adapter's
deferred-loading option, `tool_search` SHALL be bound as the provider's client-executed tool
search without an id enumeration, and a `tool_search` result SHALL reach the model, within its
Run and on replay, as the provider's tool-search call and client tool-search output carrying the
current attempt's declarations of the loaded ids that it admits.

Under `harness` and under `native` on `anthropic-messages`, the `select` items SHALL carry an
enumeration of the discoverable ids; under `native` on `openai-responses` they SHALL NOT.

The `native` projections SHALL apply only to `tool_search` observations and SHALL be an explicit
exception to the ordinary projection's provider portability. The stored part SHALL stay the
wire-neutral result, so the same observation SHALL replay in the executing model's form after a
model switch, including as ordinary text under `harness`. Within one chat epoch on a `native`
model whose admitted catalog does not change, loading a tool SHALL NOT change the request's tools.

#### Scenario: Same catalog partitions identically under both strategies

- **WHEN** the same admitted catalog, rank, and budget are resolved for a `harness` model and a `native` model
- **THEN** both attempts declare the same MCP tools and make the same tools discoverable

#### Scenario: Harness declares a loaded tool on later steps

- **WHEN** a `harness` model loads a tool through `tool_search`
- **THEN** the following steps' requests declare that tool with its current admitted schema
- **AND** the next Run's first request declares it while the loading observation is still visible

#### Scenario: Anthropic native keeps the tools array constant

- **WHEN** a `native` `anthropic-messages` model loads a tool in one Run and calls it in the next
- **THEN** both Runs send the same tools, with the loaded tool still marked deferred
- **AND** the loading result carries a tool reference for that tool in both Runs

#### Scenario: Anthropic native omits references to tools no longer admitted

- **WHEN** a replayed `tool_search` observation loaded a tool the current attempt does not admit
- **THEN** its projected result carries no tool reference for that id

#### Scenario: OpenAI native replays a load as provider items

- **WHEN** a `native` `openai-responses` model loaded a tool in an earlier Run
- **THEN** the replayed request carries a tool-search call and a client tool-search output holding that tool's current declaration
- **AND** the deferred function stays in the request's tools

#### Scenario: A model switch replays the load in the new wire's form

- **WHEN** a chat switches from a `native` model to a `harness` model after a load
- **THEN** the observation replays as ordinary text listing the loaded ids and the loaded tool is declared on the harness request
