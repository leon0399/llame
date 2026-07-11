## MODIFIED Requirements

### Requirement: First-slice setting surface

The initial schema SHALL cover exactly the shape-stable operator settings: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — deliberately not under a `models` key, which is reserved for the future model-catalog list), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.heartbeatStaleSeconds`, `runs.timeoutSeconds`, `http.trustProxy`, and — added by the tool-calling change as the first consumer-driven schema extension — the `tools` namespace: `tools.allowed` (array of registered tool ids; **default empty = no tools**, fail closed), `tools.maxStepsPerRun` (positive integer cap on tool steps per run; documented built-in default 8), and `tools.callTimeoutSeconds` (positive integer global tool-execution timeout; documented built-in default 15; individual tools may declare a per-tool override at registration — a code-level property, not a config key). Provider connection settings (`OPENAI_BASE_URL`, `OPENAI_API_KEY`) SHALL remain environment variables in this slice — they migrate into a future `providers[]` list in a follow-up change. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model (every model declares its context window; threshold resolution is per-model), never by instance settings.

#### Scenario: Migrated settings resolve from the file

- **WHEN** the file sets `defaults.modelId` and `runs.timeoutSeconds`
- **THEN** model selection defaults and the run-timeout deadman use those values

#### Scenario: No instance-level compaction knob

- **WHEN** the file attempts to set any `compaction.*` key
- **THEN** startup fails as an unknown key (the setting does not exist at this layer)

#### Scenario: Tools allowlist resolves from the file

- **WHEN** the file sets `tools.allowed` to a list of registered tool ids
- **THEN** exactly those tools are available to runs (see the `tool-calling` capability for gate semantics)

#### Scenario: Absent tools namespace means no tools

- **WHEN** the file does not set the `tools` namespace
- **THEN** the allowlist is empty and no tool is advertised or executable
