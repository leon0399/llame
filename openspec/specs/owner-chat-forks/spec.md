# owner-chat-forks

## Purpose

Allow an owner to create an independent conversation from a prefix of their own Chat that renders the same model-facing context as the source, without executing the copied turns or widening public disclosure.

## Requirements

### Requirement: The owner selects a durable prefix

The owner SHALL be able to fork their own Chat as a whole or through an inclusive user or assistant message. A whole-chat fork SHALL copy every durable message; an explicit anchor SHALL copy every user and assistant row at or below that anchor together with every `checkpoint` row whose absorbed-through sequence is at or below it. Run status SHALL NOT gate a fork, so a fork taken while a source Run is executing succeeds and copies the accepted user message. Such a fork SHALL NOT copy that Run's assistant message while it is still `running`, nor the partial output and in-Run context items stored on it. An explicit anchor naming an assistant message that is still `running` SHALL be rejected as not found. The source and its messages, `checkpoint` rows included, SHALL be read from one datastore snapshot and committed as one destination without a message-count cap. Forking SHALL NOT mutate the source. An absent source, foreign-owner source, or anchor outside the owned source Chat SHALL retain not-found behavior.

#### Scenario: Whole-chat fork during an in-flight Run

- **WHEN** `U1 A1` is complete and the source has accepted `U2` whose Run is still executing
- **THEN** the whole-chat fork contains `U1 A1 U2` and no Run
- **AND** the source Run's `running` reply to `U2`, with its partial output and stored in-Run items, is not copied
- **AND** the Run's later settlement writes only to the source

#### Scenario: An explicit anchor is inclusive

- **WHEN** the source history is `U1 A1 U2 A2` and the owner selects `U2`
- **THEN** the fork contains exactly `U1 A1 U2`
- **AND** it remains idle until the owner submits a new message

#### Scenario: An anchor naming a running reply is not found

- **WHEN** the source has accepted `U2` whose Run is still executing and the owner selects that Run's `running` reply to `U2` as the anchor
- **THEN** the fork is rejected as not found and no destination Chat is created
- **AND** the source is unchanged

### Requirement: Copied rows are literal

The fork SHALL copy message roles, parts, attachments, sender attribution, `createdAt`, and `usage` verbatim, allocating new message identities and dense sequences from 1 in copied order, and remapping `inReplyTo` to the copied rows. It SHALL NOT re-render, sanitize again, reorder, or re-budget inherited content, and SHALL NOT rewrite identifiers inside parts or usage; a copied assistant message keeps its original Run identifier as a value.

Copied usage is the price of the copied message and SHALL be retained. Fork creation SHALL create no usage of its own. Cross-Chat spend attribution is out of scope.

#### Scenario: Copied usage and timestamps are visible in the fork

- **WHEN** the owner views a copied assistant message in the fork
- **THEN** it shows the original usage and the original time
- **AND** its context receipt resolves through the original Run while that Run exists

### Requirement: The fork's Chat row carries the source's frozen context

The fork SHALL copy the source Chat's `createdAt` and every frozen prompt baseline stored on the Chat row: the recency-digest baseline, told-set, and re-bake marker, and the skill-catalog baseline, told names, and re-bake marker. Each marker SHALL be remapped to the copied checkpoint message it names; when that checkpoint row was not copied, the marker SHALL name the copied active checkpoint message, or be null when none was copied, so a copied baseline stays bound to the copied checkpoint. At an anchor before the source's latest turn, the copied told-sets are the source's current ones; entries disclosed after the anchor are not announced again in the fork. The fork SHALL copy the source's current Workspace binding, including its canonical root, bound executor identity, and generation, even when the copied prefix ends before the source's latest turn; it SHALL NOT infer or roll back the binding from copied messages. The fork SHALL NOT copy `workspace_told`, `workspace_told_from`, or the Workspace persisted detach reason: because the copied prefix may not contain the narration the source received, the fork's first accepted turn SHALL narrate its current Workspace. The fork SHALL NOT resolve a new baseline, refresh the anchor, or emit a fork notice; under identical continuation inputs and runtime versions, its inherited model-facing prefix SHALL equal the source at the copied boundary. The fork's first Run SHALL re-check any copied Workspace binding before using it. Workspace MCP clients SHALL NOT be copied from the source Chat; when a copied binding remains valid, the fork's first Run SHALL start its own Workspace MCP clients. The fork's first turn SHALL begin an ordinary disclosure epoch for tool availability and model selection, as a new Chat does.

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

### Requirement: Fork lifetime is independent and the shared path is unchanged

The destination SHALL be a new private, unarchived Chat with the existing title-copy behavior and no inherited pin or Project membership. Fork creation SHALL enqueue no Run and copy no Run, event, job, cancellation, worker, or native-effect state, except that an owner fork SHALL copy the source Chat's current Workspace binding, including its canonical root, bound executor identity, and generation. The owner-fork binding copy SHALL NOT include `workspace_told`, `workspace_told_from`, or the Workspace persisted detach reason. The fork SHALL survive source deletion; receipts for inherited turns resolve only while the original Run exists.

A fork SHALL confer no tool authority. Tool calls in a fork SHALL be evaluated exactly as in any Chat: by the executing process's permission policy and the caller's identity at call time. Copied history, receipts, and tool results SHALL NOT be read as approvals, and no approval or permission state SHALL be copied, because none is stored per Chat or per Run.

The shared/public fork path SHALL remain the public transcript projection and SHALL receive no `checkpoint` row, digest or skill baseline, usage, timestamp, creation time, or Workspace binding.

#### Scenario: A visitor forks a public compacted Chat

- **WHEN** another user forks the source through the shared/public route
- **THEN** the copy contains only the public transcript projection
- **AND** it has no checkpoint row, baselines, usage, or copied creation time

#### Scenario: A fork calls a tool its source once used

- **WHEN** the owner continues a fork whose copied history contains a completed tool call
- **THEN** the new call is evaluated by the current process policy and the owner's identity
- **AND** the copied result grants nothing the current evaluation would deny

#### Scenario: A visitor forks a bound public Chat

- **WHEN** another user forks a public Chat whose source has an active Workspace binding
- **THEN** the shared/public copy is unbound and discloses no Workspace root
- **AND** it does not inherit the binding's executor identity, generation, `workspace_told`, `workspace_told_from`, or detach reason

### Requirement: Checkpoint rows are copied with the prefix

An owner fork SHALL copy every `checkpoint` row whose absorbed-through sequence is at or below the anchor as part of the ordinary message copy, keeping its stored parts, persisted checkpoint text, raw summary, and usage while allocating a new message identity. The copy SHALL NOT rebuild a checkpoint from a raw summary, re-render its stored text, or compact during copying, and a checkpoint row that fails the existing message write validation SHALL fail the whole fork.

#### Scenario: A checkpoint beyond the anchor is not copied

- **WHEN** the owner selects message 15 and the latest `checkpoint` row's absorbed-through sequence is 20
- **THEN** that checkpoint is not copied
- **AND** an earlier `checkpoint` row whose absorbed-through sequence is 10 is copied and is the fork's active checkpoint

### Requirement: A copied checkpoint absorbs what its source absorbed

Copied rows, checkpoint rows among them, SHALL take dense sequences from 1 in copied order as every other copied row does, so a copied checkpoint SHALL NOT preserve its source sequence. Its absorbed-through sequence SHALL be remapped onto the copied row it named, so that a copied checkpoint absorbs exactly what it absorbed in the source, and the fork's replay SHALL use the copied checkpoint followed by the copied rows after its absorbed-through sequence.

#### Scenario: A copied checkpoint absorbs the same rows

- **WHEN** an owner forks a Chat whose copied prefix contains a `checkpoint` row
  whose absorbed-through sequence named the source row at `N`
- **THEN** the fork holds a `checkpoint` row whose absorbed-through sequence names
  the copied row that came from `N`, not a row at sequence `N`
- **AND** its replayed checkpoint, retained rows, and absorbed-message count equal the source's

### Requirement: A shared or public fork receives no checkpoint row

A shared or public fork SHALL copy only text-only user and assistant rows and SHALL NOT copy a `checkpoint` row.

#### Scenario: A shared fork receives no checkpoint row

- **WHEN** another user forks a compacted Chat through the shared/public route
- **THEN** the copy contains only the public transcript projection
- **AND** it holds no `checkpoint` row and discloses no checkpoint text or raw summary
