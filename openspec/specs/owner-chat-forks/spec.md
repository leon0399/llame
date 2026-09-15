# owner-chat-forks

## Purpose

Allow an owner to create an independent conversation from a prefix of their own Chat that renders the same model-facing context as the source, without executing the copied turns or widening public disclosure.

## Requirements

### Requirement: The owner selects a durable prefix

The owner SHALL be able to fork their own Chat as a whole or through an inclusive user or assistant message. A whole-chat fork SHALL copy every durable message; an explicit anchor SHALL copy through the requested message. Run status SHALL NOT gate a fork, so a fork taken while a source Run is executing succeeds and copies the accepted user message. The source, its messages, and its compactions SHALL be read from one datastore snapshot and committed as one destination without a message-count cap. Forking SHALL NOT mutate the source. An absent source, foreign-owner source, or anchor outside the owned source Chat SHALL retain not-found behavior.

#### Scenario: Whole-chat fork during an in-flight Run

- **WHEN** `U1 A1` is complete and the source has accepted `U2` whose Run is still executing
- **THEN** the whole-chat fork contains `U1 A1 U2` and no Run
- **AND** the Run's later settlement writes only to the source

#### Scenario: An explicit anchor is inclusive

- **WHEN** the source history is `U1 A1 U2 A2` and the owner selects `U2`
- **THEN** the fork contains exactly `U1 A1 U2`
- **AND** it remains idle until the owner submits a new message

### Requirement: Copied rows are literal

The fork SHALL copy message roles, parts, attachments, sender attribution, `createdAt`, and `usage` verbatim, allocating new message identities and dense sequences from 1 in copied order, and remapping `inReplyTo` to the copied rows. It SHALL NOT re-render, sanitize again, reorder, or re-budget inherited content, and SHALL NOT rewrite identifiers inside parts or usage; a copied assistant message keeps its original Run identifier as a value.

Copied usage is the price of the copied message and SHALL be retained. Fork creation SHALL create no usage of its own. Cross-Chat spend attribution is out of scope.

#### Scenario: Copied usage and timestamps are visible in the fork

- **WHEN** the owner views a copied assistant message in the fork
- **THEN** it shows the original usage and the original time
- **AND** its context receipt resolves through the original Run while that Run exists

### Requirement: Compactions within the prefix are copied with their lineage

The fork SHALL copy every compaction whose coverage lies within the copied prefix, keeping `uptoSeq`, `summary`, `replacementHistory`, `usage`, and `createdAt` verbatim, allocating new identities, and remapping `parentId` to the copied parent. The fork's replay SHALL use the copied replacement history followed by the retained messages after its coverage boundary. The copy SHALL NOT rebuild a checkpoint from raw summary or compact during copying; a compaction that fails the existing write validation SHALL fail the whole fork.

#### Scenario: The source has multiple compaction generations

- **WHEN** the copied prefix covers a checkpoint with two ancestors
- **THEN** the fork holds all three with internal lineage
- **AND** its active replacement history, retained tail, and absorbed-message count equal the source's

#### Scenario: A checkpoint covers messages beyond the anchor

- **WHEN** the owner selects message 15 and the latest checkpoint covers through 20
- **THEN** that checkpoint is not copied
- **AND** an earlier checkpoint covering through 10 is copied and is the fork's active checkpoint

### Requirement: The fork's Chat row carries the source's frozen context

The fork SHALL copy the source Chat's `createdAt` and every frozen prompt baseline stored on the Chat row: the recency-digest baseline, told-set, and re-bake marker, and the skill-catalog baseline, told names, and re-bake marker. Each marker SHALL be remapped to the copied compaction it names; when that compaction was not copied, the marker SHALL name the copied active compaction, or be null when none was copied, so a copied baseline stays bound to the copied checkpoint. At an anchor before the source's latest turn, the copied told-sets are the source's current ones; entries disclosed after the anchor are not announced again in the fork. The fork SHALL NOT resolve a new baseline, refresh the anchor, or emit a fork notice; under identical continuation inputs and runtime versions, its inherited model-facing prefix SHALL equal the source's at the copied boundary. The fork's first turn SHALL begin an ordinary disclosure epoch for tool availability and model selection, as a new Chat does.

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

### Requirement: Fork lifetime is independent and the shared path is unchanged

The destination SHALL be a new private, unarchived Chat with the existing title-copy behavior and no inherited pin or Project membership. Fork creation SHALL enqueue no Run and copy no Run, event, job, cancellation, worker, or native-effect state. The fork SHALL survive source deletion; receipts for inherited turns resolve only while the original Run exists.

The shared/public fork path SHALL remain the public transcript projection and SHALL receive no compaction, digest or skill baseline, usage, timestamp, or creation time.

#### Scenario: A visitor forks a public compacted Chat

- **WHEN** another user forks the source through the shared/public route
- **THEN** the copy contains only the public transcript projection
- **AND** it has no compactions, baselines, usage, or copied creation time
