## MODIFIED Requirements

### Requirement: The fork's Chat row carries the source's frozen context

The fork MUST copy source `createdAt` and the Chat-row skill baseline, told names, and re-bake marker. It MUST remap that marker to its copied checkpoint. If that checkpoint is absent, use the copied active checkpoint, or null without one. At an earlier anchor, copied skill told names MUST remain the source's current names.

Digest state MUST derive only from copied effective items. Source items after the anchor MUST NOT suppress disclosure in the fork. Copy a checkpoint companion whenever its selected checkpoint qualifies for the copied prefix. Remap the companion association to that copied checkpoint. The companion's higher storage sequence MUST NOT exclude it from its selected checkpoint pair.

The fork MUST copy the source's current canonical Workspace root, executor identity, and generation, even at an earlier message anchor. It MUST NOT infer an older binding from history. It MUST NOT copy `workspace_told`, `workspace_told_from`, or the persisted detach reason. Its first accepted turn MUST narrate its current Workspace. Its first Run MUST recheck the copied binding before use.

Fork creation MUST NOT resolve new baselines, refresh the anchor, or emit a fork notice. Under identical continuation conditions, the inherited prefix MUST equal the source at the copied boundary. The first valid bound Run MUST start independent Workspace MCP clients without a source-client copy. The first turn MUST begin ordinary tool-availability and model-selection disclosure epochs.

#### Scenario: The first local turn renders the source's prefix

- **WHEN** the fork and its source receive identical new input under identical continuation conditions
- **THEN** their system prompts and inherited history are equal through the ordinary context builder and serializer
- **AND** no difference arises from the fork's storage identities or the time it was created

#### Scenario: The anchor precedes the checkpoint that re-baked a baseline

- **WHEN** the source's skill baseline was re-resolved at checkpoint row `C2` and the owner selects an anchor that copies only `C1`
- **THEN** the fork's skill marker names the copied `C1` message
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

## ADDED Requirements

### Requirement: Forked digest state follows the copied effective prefix

An owner fork MUST copy digest item text literally with its selected prefix. It MUST derive disclosure from only those copied effective items. It MUST remap a digest companion association to the copied checkpoint. It MUST NOT copy digest columns or import source state after the anchor. A public or shared fork MUST receive no digest parts, comparison metadata, or Workspace affinity from them.

#### Scenario: An early anchor does not inherit later disclosure

- **WHEN** the source announces Chat B after the selected fork anchor
- **THEN** the fork has no comparison entry for B unless its copied prefix already disclosed B

#### Scenario: A copied companion stays next to its checkpoint

- **WHEN** a fork selects a checkpoint with a higher-sequence digest companion
- **THEN** the fork copies both and remaps their association
- **AND** replay places the unchanged companion text immediately after that checkpoint
