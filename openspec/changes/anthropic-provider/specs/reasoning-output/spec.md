## MODIFIED Requirements

### Requirement: Existing UI support receives durable reasoning parts

The backend SHALL use the existing AI SDK reasoning stream protocol and persisted reasoning part shape, extended only by the optional opaque provider metadata this capability defines. The web chat SHALL render reasoning parts in persisted order. Consecutive reasoning parts with no intervening tool or visible text part SHALL share one Thinking panel. A tool or visible text part SHALL split panels so occurrence order is preserved. A panel whose grouped parts carry no reasoning text SHALL NOT be rendered: a provider that withholds thinking text still returns thinking blocks whose text is empty and whose metadata is needed for replay, so such parts persist and replay exactly as any other reasoning part while the chat shows nothing for them.

#### Scenario: Existing renderer receives historical reasoning

- **WHEN** a user reloads a chat containing a persisted reasoning part
- **THEN** the existing client receives that part in its persisted order

#### Scenario: Consecutive summary parts share one Thinking panel

- **WHEN** a run emits two reasoning-summary parts, then a tool call, then another reasoning-summary part
- **THEN** the chat shows one Thinking panel for the first two summaries, the tool, then a second Thinking panel
- **AND** it does not hoist every reasoning part above the tool

#### Scenario: An empty reasoning segment renders no panel

- **WHEN** an assistant message holds consecutive reasoning parts whose text is empty, for example signed thinking blocks returned with their text withheld
- **THEN** the chat renders no Thinking panel for that segment
- **AND** the parts persist with their provider metadata and are replayed to the provider unchanged
