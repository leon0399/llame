## ADDED Requirements

### Requirement: Per-model tool-search threshold

Each `models[]` entry MAY include an optional positive integer `toolSearchThresholdTokens`.
When present it SHALL be the declaration budget for that model's deferrable (MCP) declarations;
when absent the budget SHALL resolve to one tenth of the entry's **usable context** rounded
down. The usable context SHALL be the entry's compaction trigger threshold, the same value
`available-models` already resolves as `compactionThresholdTokens` when set and
`contextWindowTokens × COMPACTION_WINDOW_RATIO` otherwise. A `contextWindowTokens` the instance
never reaches SHALL NOT size the budget, so a configured compaction threshold below the window
lowers the budget with it. There SHALL be no instance-level tool-search setting, matching the
rule that context-window behavior is declared per model. The published JSON Schema SHALL declare the key,
and a non-integer, zero, or negative value SHALL fail startup naming
the model id and the key.

#### Scenario: Threshold defaults from the usable context

- **WHEN** a model entry omits both `toolSearchThresholdTokens` and `compactionThresholdTokens`
- **THEN** its declaration budget is one tenth of `contextWindowTokens × COMPACTION_WINDOW_RATIO`, rounded down

#### Scenario: A compaction threshold lowers the default budget

- **WHEN** a model entry declares a `contextWindowTokens` of 1000000 and a `compactionThresholdTokens` of 200000, and omits `toolSearchThresholdTokens`
- **THEN** its declaration budget is 20000, one tenth of the 200000 tokens the conversation can actually use
- **AND** it is not 100000, which one tenth of the unreachable window would have allowed

#### Scenario: Explicit threshold overrides the ratio

- **WHEN** a model entry sets `toolSearchThresholdTokens` to a positive integer
- **THEN** that value is the budget regardless of the entry's usable context

#### Scenario: Threshold below any inventory entry cuts every MCP tool

- **WHEN** a model entry sets `toolSearchThresholdTokens` below the inventory estimate of every eligible MCP tool
- **THEN** every MCP tool is recorded `unavailable` with reason `declaration_budget_exceeded`
- **AND** no tool is discoverable, so no `tool_search` is synthesized
- **AND** the admitted code-owned tools remain declared

#### Scenario: Invalid threshold fails startup

- **WHEN** a model entry sets `toolSearchThresholdTokens` to zero, a negative number, a fraction, or a string
- **THEN** startup fails naming the model id and `toolSearchThresholdTokens`

### Requirement: Per-model tool-search strategy

Each `models[]` entry MAY include an optional `toolSearch` string, one of `harness` or `native`,
defaulting to `harness`. `native` SHALL be accepted only when the entry's provider `type` is
`anthropic-messages` or `openai-responses`; on any other provider type, including
`openai-completions`, `opencode-go`, and `openai-codex`, startup SHALL fail naming the model id
and `toolSearch`. An unknown value SHALL fail startup the same way. The published JSON Schema
SHALL declare the key and its enumeration. The setting SHALL NOT be verified against the
provider's model support at startup; the operator declares `native` for models that support the
provider's deferred tool loading, and a provider that rejects it fails the affected request
under the existing run failure contract without falling back to `harness`.

#### Scenario: Default strategy

- **WHEN** a model entry omits `toolSearch`
- **THEN** its Runs use the `harness` strategy

#### Scenario: Native strategy on a supported wire

- **WHEN** a model on an `anthropic-messages` or `openai-responses` provider sets `toolSearch` to `native`
- **THEN** startup succeeds and its Runs use that wire's native delivery

#### Scenario: Native strategy on an unsupported wire

- **WHEN** a model on an `openai-completions`, `opencode-go`, or `openai-codex` provider sets `toolSearch` to `native`
- **THEN** startup fails naming the model id and `toolSearch`

#### Scenario: Unknown strategy

- **WHEN** a model entry sets `toolSearch` to a value outside the enumeration
- **THEN** startup fails naming the model id and `toolSearch`

#### Scenario: Provider rejects native delivery

- **WHEN** a model declared `native` is served by a model version that rejects deferred tools
- **THEN** the affected request fails under the existing run failure contract
- **AND** no request is retried under `harness`
