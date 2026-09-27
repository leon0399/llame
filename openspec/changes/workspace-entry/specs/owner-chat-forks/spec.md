## MODIFIED Requirements

### Requirement: The fork's Chat row carries the source's frozen context

The fork SHALL copy the source Chat's `createdAt` and every frozen prompt baseline stored on the Chat row: the recency-digest baseline, told-set, and re-bake marker, and the skill-catalog baseline, told names, and re-bake marker. Each marker SHALL be remapped to the copied compaction it names; when that compaction was not copied, the marker SHALL name the copied active compaction, or be null when none was copied, so a copied baseline stays bound to the copied checkpoint. At an anchor before the source's latest turn, the copied told-sets are the source's current ones; entries disclosed after the anchor are not announced again in the fork. The fork SHALL copy the source's current Workspace binding, including its canonical root, bound executor identity, and generation, even when the copied prefix ends before the source's latest turn; it SHALL NOT infer or roll back the binding from copied messages. The fork SHALL NOT copy the Workspace told-state or persisted detach reason: because the copied prefix may not contain the narration the source received, the fork's first accepted turn SHALL narrate its current Workspace. The fork SHALL NOT resolve a new baseline, refresh the anchor, or emit a fork notice; under identical continuation inputs and runtime versions, its inherited model-facing prefix SHALL equal the source's at the copied boundary. The fork's first Run SHALL re-check any copied Workspace binding before using it. Workspace MCP clients SHALL NOT be copied from the source Chat; when a copied binding remains valid, the fork's first Run SHALL start its own Workspace MCP clients. The fork's first turn SHALL begin an ordinary disclosure epoch for tool availability and model selection, as a new Chat does.

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

### Requirement: Fork lifetime is independent and the shared path is unchanged

The destination SHALL be a new private, unarchived Chat with the existing title-copy behavior and no inherited pin or Project membership. Fork creation SHALL enqueue no Run and copy no Run, event, job, cancellation, worker, or native-effect state, except that an owner fork SHALL copy the source Chat's current Workspace binding, including its canonical root, bound executor identity, and generation. The owner-fork binding copy SHALL NOT include the Workspace told-state or persisted detach reason. The fork SHALL survive source deletion; receipts for inherited turns resolve only while the original Run exists.

A fork SHALL confer no tool authority. Tool calls in a fork SHALL be evaluated exactly as in any Chat: by the executing process's permission policy and the caller's identity at call time. Copied history, receipts, and tool results SHALL NOT be read as approvals, and no approval or permission state SHALL be copied, because none is stored per Chat or per Run.

The shared/public fork path SHALL remain the public transcript projection and SHALL receive no compaction, digest or skill baseline, usage, timestamp, creation time, or Workspace binding.

#### Scenario: A visitor forks a public compacted Chat

- **WHEN** another user forks the source through the shared/public route
- **THEN** the copy contains only the public transcript projection
- **AND** it has no compactions, baselines, usage, or copied creation time

#### Scenario: A visitor forks a bound public Chat

- **WHEN** another user forks a public Chat whose source has an active Workspace binding
- **THEN** the shared/public copy is unbound and discloses no Workspace root
- **AND** it does not inherit the binding's executor identity, generation, told-state, or detach reason

#### Scenario: A fork calls a tool its source once used

- **WHEN** the owner continues a fork whose copied history contains a completed tool call
- **THEN** the new call is evaluated by the current process policy and the owner's identity
- **AND** the copied result grants nothing the current evaluation would deny
