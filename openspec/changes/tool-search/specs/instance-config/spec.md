## ADDED Requirements

### Requirement: Per-model tool-search threshold

Each `models[]` entry MAY include an optional positive integer `toolSearchThresholdTokens`.
When present it SHALL be the declaration budget for that model's deferrable (MCP) declarations;
when absent the budget SHALL resolve to one tenth of the entry's `contextWindowTokens` rounded
down. There SHALL be no instance-level tool-search setting, matching the rule that
context-window behavior is declared per model. The published JSON Schema SHALL declare the key,
and a non-integer, zero, or negative value SHALL fail startup naming
the model id and the key.

#### Scenario: Threshold defaults from the context window

- **WHEN** a model entry omits `toolSearchThresholdTokens`
- **THEN** its declaration budget is `floor(contextWindowTokens / 10)`

#### Scenario: Explicit threshold overrides the ratio

- **WHEN** a model entry sets `toolSearchThresholdTokens` to a positive integer
- **THEN** that value is the budget regardless of `contextWindowTokens`

#### Scenario: Tiny threshold defers everything it can

- **WHEN** a model entry sets `toolSearchThresholdTokens` to `1` and the model has eligible MCP tools
- **THEN** every Run on that model defers every MCP tool and binds `tool_search`
- **AND** MCP tools whose inventory does not fit are bound as `unavailable` with reason `declaration_budget_exceeded`
- **AND** the code-owned tools remain declared

#### Scenario: Invalid threshold fails startup

- **WHEN** a model entry sets `toolSearchThresholdTokens` to zero, a negative number, a fraction, or a string
- **THEN** startup fails naming the model id and `toolSearchThresholdTokens`

### Requirement: Per-model tool-search strategy

Each `models[]` entry MAY include an optional `toolSearch` string, one of `harness` or `openai`,
defaulting to `harness`. `openai` SHALL be accepted only when the entry's provider is the
provider entry whose `id` is exactly `openai`, the same entry the runtime already routes to the
Responses API; any other provider SHALL fail startup naming the model id and `toolSearch`. An
unknown value SHALL fail startup the same way. The published JSON Schema SHALL declare the key
and its enumeration. The setting SHALL NOT be verified against the provider's model support at
startup; the operator declares it for models that support the provider's tool search.

#### Scenario: Default strategy

- **WHEN** a model entry omits `toolSearch`
- **THEN** its Runs use the `harness` strategy

#### Scenario: OpenAI strategy on the native provider

- **WHEN** a model on the provider entry with id `openai` sets `toolSearch` to `openai`
- **THEN** startup succeeds and its Runs use the `openai` strategy

#### Scenario: OpenAI strategy on a compatible endpoint

- **WHEN** a model on any other provider sets `toolSearch` to `openai`
- **THEN** startup fails naming the model id and `toolSearch`

#### Scenario: Unknown strategy

- **WHEN** a model entry sets `toolSearch` to a value outside the enumeration
- **THEN** startup fails naming the model id and `toolSearch`
