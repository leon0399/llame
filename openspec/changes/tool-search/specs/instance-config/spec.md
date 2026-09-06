## ADDED Requirements

### Requirement: Per-model tool-search threshold

Each `models[]` entry MAY include an optional non-negative integer `toolSearchThresholdTokens`.
When present it SHALL be the declaration budget for that model; when absent the budget SHALL
resolve to one tenth of the entry's `contextWindowTokens` rounded down. A value of `0` SHALL
mean every turn on that model defers MCP tools. There SHALL be no instance-level tool-search
setting, matching the rule that context-window behavior is declared per model. The published
JSON Schema SHALL declare the key, and a non-integer or negative value SHALL fail startup naming
the model id and the key.

#### Scenario: Threshold defaults from the context window

- **WHEN** a model entry omits `toolSearchThresholdTokens`
- **THEN** its declaration budget is `floor(contextWindowTokens / 10)`

#### Scenario: Explicit threshold overrides the ratio

- **WHEN** a model entry sets `toolSearchThresholdTokens` to a positive integer
- **THEN** that value is the budget regardless of `contextWindowTokens`

#### Scenario: Zero forces deferral

- **WHEN** a model entry sets `toolSearchThresholdTokens` to `0`
- **THEN** every Run on that model with at least one eligible MCP tool binds `tool_search` and defers MCP tools

#### Scenario: Invalid threshold fails startup

- **WHEN** a model entry sets `toolSearchThresholdTokens` to a negative number, a fraction, or a string
- **THEN** startup fails naming the model id and `toolSearchThresholdTokens`

### Requirement: Per-model tool-search strategy

Each `models[]` entry MAY include an optional `toolSearch` string, one of `harness` or `openai`,
defaulting to `harness`. `openai` SHALL be accepted only when the entry's provider is the native
OpenAI provider; any other provider SHALL fail startup naming the model id and `toolSearch`. An
unknown value SHALL fail startup the same way. The published JSON Schema SHALL declare the key
and its enumeration. The setting SHALL NOT be verified against the provider's model support at
startup; the operator declares it for models that support the provider's tool search.

#### Scenario: Default strategy

- **WHEN** a model entry omits `toolSearch`
- **THEN** its Runs use the `harness` strategy

#### Scenario: OpenAI strategy on the native provider

- **WHEN** a model on the native OpenAI provider sets `toolSearch` to `openai`
- **THEN** startup succeeds and its Runs use the `openai` strategy

#### Scenario: OpenAI strategy on a compatible endpoint

- **WHEN** a model on any other provider sets `toolSearch` to `openai`
- **THEN** startup fails naming the model id and `toolSearch`

#### Scenario: Unknown strategy

- **WHEN** a model entry sets `toolSearch` to a value outside the enumeration
- **THEN** startup fails naming the model id and `toolSearch`
