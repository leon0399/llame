## MODIFIED Requirements

### Requirement: Preserve llame execution semantics

The provider SHALL preserve llame's effective instructions, authorized tools, ordered tool calls/results, provider-returned condensed reasoning summaries, persisted effort, cancellation, and execution bounds. It SHALL persist the SDK `reasoningSummary: "auto"` display text as `reasoning` parts under the `reasoning-output` contract, together with the reasoning-item identifier and encrypted reasoning the Responses wire returns for each part as that part's opaque provider metadata. That metadata SHALL be replayed only to the provider on requests for the same Chat and SHALL NOT reach owner-visible output, markdown export, search, public shares, logs, telemetry, or errors. Opaque provider state not bound to a persisted reasoning part SHALL remain transient. It SHALL support compaction through the same transport and existing source-model/effort semantics. Unsupported meaningful request features SHALL fail explicitly rather than being silently discarded.

#### Scenario: Authorized multi-step Run

- **WHEN** a model requests an available tool and continues after its result
- **THEN** llame authorizes and executes the tool under the bound owner and Run
- **AND** the continuation uses the ordered result and existing prompt/history contract

#### Scenario: Cancel inference

- **WHEN** the owner cancels an active streaming Run
- **THEN** provider streaming is aborted and the Run settles under existing cancellation and tool-effect rules
- **AND** no replacement Run is started

#### Scenario: Compaction

- **WHEN** a Codex-backed source Run requires compaction
- **THEN** compaction uses the Codex transport and source model's persisted effort
- **AND** persisted usage identifies the executing model under the existing compaction contract

#### Scenario: Optional title failure

- **WHEN** a configured Codex title call is unsupported or fails
- **THEN** the existing optional title fallback/failure behavior applies without invalidating the completed answer
- **AND** title requests carry no effort inherited from the Run and never fall back to another provider

#### Scenario: Encrypted reasoning survives with its part

- **WHEN** a Codex-backed Run receives a reasoning summary whose Responses item carries an identifier and encrypted content
- **THEN** the persisted reasoning part carries them as opaque provider metadata
- **AND** a later request for the same Chat replays them with the part, and no owner-facing surface shows them
