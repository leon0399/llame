## MODIFIED Requirements

### Requirement: The fork's Chat row carries the source's frozen context

The fork SHALL copy the source Chat's `createdAt` and every frozen baseline stored on the Chat row: the recency-digest baseline, told-set, and re-bake marker, the skill-catalog baseline, told names, and re-bake marker, and the MCP usage rank and its re-bake marker. Each marker SHALL be remapped to the copied compaction it names; when that compaction was not copied, the marker SHALL name the copied active compaction, or be null when none was copied, so a copied baseline stays bound to the copied checkpoint. At an anchor before the source's latest turn, the copied told-sets are the source's current ones; entries disclosed after the anchor are not announced again in the fork. The fork SHALL copy the source's current Workspace binding, including its canonical root, bound executor identity, and generation, even when the copied prefix ends before the source's latest turn; it SHALL NOT infer or roll back the binding from copied messages. The fork SHALL NOT copy `workspace_told`, `workspace_told_from`, or the Workspace persisted detach reason: because the copied prefix may not contain the narration the source received, the fork's first accepted turn SHALL narrate its current Workspace. The fork SHALL NOT resolve a new baseline, refresh the anchor, or emit a fork notice; under identical continuation inputs and runtime versions, its inherited model-facing prefix SHALL equal the source at the copied boundary. The fork's first Run SHALL re-check any copied Workspace binding before using it. Workspace MCP clients SHALL NOT be copied from the source Chat; when a copied binding remains valid, the fork's first Run SHALL start its own Workspace MCP clients. The fork's first turn SHALL begin an ordinary disclosure epoch for tool availability and model selection, as a new Chat does.

#### Scenario: The first local turn renders the source's prefix

- **WHEN** the fork and its source receive identical new input under identical continuation conditions
- **THEN** their system prompts and inherited history are equal through the ordinary context builder and serializer
- **AND** no difference arises from the fork's storage identities or the time it was created

#### Scenario: The anchor precedes the checkpoint that re-baked a baseline

- **WHEN** the source's skill baseline was re-resolved at checkpoint `C2` and the owner selects an anchor that copies only `C1`
- **THEN** the fork's skill marker names the copied `C1`
- **AND** the fork's first turn reuses the copied baseline instead of resolving the live catalog

#### Scenario: Source has no baseline

- **WHEN** an owner forks a Chat that carries no digest or skill baseline
- **THEN** the fork carries none
- **AND** its first Run initializes them under the ordinary rules

#### Scenario: Workspace binding is copied and re-narrated

- **WHEN** an owner forks a Chat with an active Workspace binding, anchored at a message before the Workspace was entered
- **THEN** the fork carries the same canonical root, executor identity, and generation as the source
- **AND** the fork's first accepted turn narrates the current Workspace because no told-state was copied
- **AND** its first Run re-checks the binding and starts independent Workspace MCP clients rather than reusing the source Chat's clients

#### Scenario: A fork of a detached Chat stays unbound

- **WHEN** an owner forks a Chat whose Workspace binding was detached but whose history contains earlier Workspace narration
- **THEN** the fork has no Workspace binding and the copied narration does not restore one
- **AND** its first Run remains unbound unless a new successful `enter_workspace` call establishes a binding
