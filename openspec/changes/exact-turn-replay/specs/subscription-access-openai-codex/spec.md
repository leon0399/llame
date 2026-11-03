## MODIFIED Requirements

### Requirement: Preserve llame execution semantics

The provider MUST keep the effective instructions of llame, its authorized tools,
and the ordered tool calls and results. It MUST keep the condensed reasoning
summaries that the provider returns. It MUST also keep the persisted effort, cancellation, and the
execution bounds. It MUST persist the SDK `reasoningSummary: "auto"` display text
as `reasoning` parts under the `reasoning-output` contract. With those parts, it
MUST persist the opaque provider metadata that the Responses wire returns. This
metadata is the reasoning item id on each part of that item. It also includes the
encrypted reasoning of the item, on the one part to which the adapter attaches
it. The system MUST NOT copy
the encrypted reasoning to the other parts of the item. The provider metadata of
text and tool parts persists under `turn-replay`. All this metadata MUST replay
only to the provider, on requests for the same Chat that the model rule of
`reasoning-output` allows. It MUST NOT reach owner-visible output, markdown
export, search, public shares, logs, telemetry, or errors. Opaque provider state
that is not bound to a persisted part MUST stay transient. The provider MUST
support compaction through the same transport, with the source-model and effort
semantics of compaction. A meaningful request feature that it cannot carry MUST
fail explicitly, and the system MUST NOT discard it silently.

#### Scenario: Authorized multi-step Run

- **WHEN** a model requests an available tool and continues after its result
- **THEN** llame authorizes and executes the tool under the bound owner and Run
- **AND** the continuation uses the ordered result and the prompt and history contract

#### Scenario: Cancel inference

- **WHEN** the owner cancels an active streaming Run
- **THEN** the provider stream stops, and the Run settles under the cancellation and tool-effect rules
- **AND** no replacement Run starts

#### Scenario: Compaction

- **WHEN** a Codex-backed source Run requires compaction
- **THEN** compaction uses the Codex transport and the persisted effort of the source model
- **AND** persisted usage names the model that executed it, under the compaction contract

#### Scenario: Optional title failure

- **WHEN** a configured Codex title call is not supported or fails
- **THEN** the optional title fallback and failure behavior applies, and the completed answer stays valid
- **AND** title requests carry no effort from the Run and never fall back to another provider

#### Scenario: Encrypted reasoning survives with its part

- **WHEN** a Codex-backed Run receives a reasoning summary whose Responses item carries an id and encrypted content
- **THEN** the persisted reasoning part carries them as opaque provider metadata
- **AND** a later request of the same Chat on the same model replays them with the part, and no owner-facing surface shows them
