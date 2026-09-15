## Purpose

Allow an authenticated owner to create an independent conversation from a selected prefix of their own history that renders the same model-facing context as the source, without executing the copied turns or widening public disclosure.

## ADDED Requirements

### Requirement: The owner selects a durable prefix

The owner SHALL be able to fork their own Chat as a whole or through an inclusive user or assistant message. The source, its messages, and its compactions SHALL be read from one consistent datastore snapshot and committed as one complete destination. The system SHALL copy the entire selected prefix without a message-count cap or partial-success response.

A whole-chat fork SHALL copy every durable message. An explicit anchor SHALL copy through the requested message. Run status SHALL NOT gate a fork: a source with an in-flight Run holds its accepted user message and no assistant row, and that user message is copied. An absent source, foreign-owner source, or anchor outside the owned source Chat SHALL retain not-found behavior. Forking SHALL NOT settle, cancel, retry, or otherwise mutate the source.

#### Scenario: Whole-chat fork during an in-flight Run

- **WHEN** `U1 A1` is complete and the source has accepted `U2` whose Run is still executing
- **THEN** the whole-chat fork contains exactly `U1 A1 U2`
- **AND** it contains no assistant row, tool output, or execution state for `U2`
- **AND** the Run's later settlement writes only to the source

#### Scenario: An explicit user anchor is inclusive

- **WHEN** the source history is `U1 A1 U2 A2` and the owner selects `U2`
- **THEN** the fork contains exactly `U1 A1 U2`
- **AND** it remains idle without generating an answer to the copied `U2`

#### Scenario: An explicit assistant anchor is inclusive

- **WHEN** the source history is `U1 A1 U2 A2` and the owner selects `A1`
- **THEN** the fork contains exactly `U1 A1`

#### Scenario: A large prefix spans several insertion batches

- **WHEN** the selected history exceeds a single bulk-insert batch
- **THEN** every selected message is copied in stored order
- **AND** a failure in any batch rolls back the whole fork

### Requirement: Inherited message content remains literal

The fork SHALL preserve copied roles, message parts and their order, attachments, sender attribution, original timestamps, and usage. It SHALL allocate independent storage identities and dense sequences from 1 in copied order, and SHALL preserve reply relationships between copied messages. Only storage references necessary to establish the destination SHALL be remapped.

Model-visible text, tool-call identifiers, provider-visible identifiers, stored context-item text, and identifiers embedded in historical payloads SHALL remain verbatim. The copy SHALL NOT re-render, sanitize again, reorder, summarize, or re-budget inherited content. Referenced external resources SHALL NOT be copied or granted new authority because their locators occur in history.

Copied usage is the price of the copied message and SHALL be retained as such. Fork creation SHALL create no new usage. Cross-Chat spend attribution is out of scope for this capability.

#### Scenario: A tool result mentions the source Chat

- **WHEN** copied tool output includes source Chat identifiers and a tool-call ID
- **THEN** those payload values remain unchanged
- **AND** copied assistant replies reference the copied user messages through remapped storage relationships

#### Scenario: A formatter changed after the original turn

- **WHEN** an owner forks messages containing previously rendered context items
- **THEN** their original text and position are retained
- **AND** the current formatter does not regenerate them

#### Scenario: Copied usage and timestamps are visible in the fork

- **WHEN** the owner views a copied assistant message in the fork
- **THEN** it shows the original usage and the original time
- **AND** the fork's creation time does not replace either

### Requirement: Applicable compaction lineage remains replay authority

The fork SHALL copy every compaction whose coverage lies within the copied prefix, including its parent lineage, raw summary, materialized replacement history, usage, and original timestamp. Coverage and lineage references SHALL address the copied history. The fork's replay SHALL use the copied replacement history followed by the retained messages after its coverage boundary. It SHALL NOT rebuild a checkpoint from raw summary, repeat compaction during copying, or substitute uncompacted history when a required checkpoint is malformed. A malformed required lineage SHALL fail atomically without a partial copy.

#### Scenario: The source has multiple compaction generations

- **WHEN** the copied prefix covers an active checkpoint with two ancestors
- **THEN** the fork retains all three checkpoints with internal destination lineage
- **AND** its active replacement history and retained tail equal the source's

#### Scenario: A checkpoint covers messages beyond the anchor

- **WHEN** the owner selects message 15 and a checkpoint covers messages through 20
- **THEN** that checkpoint is not copied
- **AND** an earlier checkpoint covering through 10 is copied and becomes the fork's active checkpoint

#### Scenario: Replacement history is malformed

- **WHEN** a copied checkpoint lacks valid non-empty replacement history
- **THEN** the fork fails without committing a destination
- **AND** it does not regenerate the checkpoint or silently discard compaction

### Requirement: The fork renders the source's current context

The fork SHALL copy the source Chat's current digest baseline, told-set, and re-bake marker, and its context origin, so that under identical continuation inputs and runtime versions the fork's inherited model-facing prefix equals the source's at the copied boundary. The re-bake marker SHALL be remapped to the copied compaction and SHALL be absent when that compaction was not copied.

Fork creation SHALL emit no model-facing notice and SHALL NOT refresh digest content, corpus, or anchor. The fork's first turn SHALL begin an ordinary disclosure epoch for tool availability and model selection, as a new Chat does; those items follow the inherited history and do not alter it. Future model, configuration, consent, corpus, and availability changes follow ordinary behavior.

#### Scenario: The first local turn uses unchanged inputs

- **WHEN** the fork and its source receive identical new input under identical continuation conditions
- **THEN** their inherited provider-facing prefix is equal through the ordinary serializer
- **AND** no difference arises from the fork's new storage IDs or creation time

#### Scenario: Historical anchor precedes a later digest append

- **WHEN** the source disclosed a new digest entry after the selected anchor
- **THEN** the fork inherits the source's current told-set including that entry
- **AND** no digest content is re-resolved at fork time

### Requirement: Fork lifetime and execution are independent

The destination SHALL be a new private, unarchived Chat with the existing title-copy behavior and no inherited pin or Project membership. It SHALL survive source deletion and evolve independently after commit. Fork-of-fork SHALL preserve inherited content and origin without needing any ancestor Chat.

Fork creation SHALL make no model or compaction inference call and enqueue no Run. It SHALL NOT copy Runs, event streams, active jobs, cancellation state, worker identity, or native-effect fences. Inherited receipts resolve through the original Run while it exists; after source deletion they are absent.

#### Scenario: The source is deleted

- **WHEN** the owner deletes the source after a successful fork
- **THEN** the fork's history, checkpoints, digest state, and anchor remain available
- **AND** receipts for inherited turns are not found

#### Scenario: An inherited tool result describes a native write

- **WHEN** a copied assistant message contains a completed native mutation observation
- **THEN** it remains historical output only
- **AND** the fork does not copy its mutation fence or execute the write again

### Requirement: Owner-only fidelity never widens shared disclosure

Owner identity SHALL come from authenticated server context and SHALL be enforced in datastore reads and writes. Missing identity or a foreign reference SHALL fail closed and commit nothing.

The shared/public fork path SHALL continue to copy only what its existing public response allows. It SHALL receive no compaction, digest state, usage, timestamps, context origin, or source-owner metadata. Public views of an owner fork, ordinary exports, and search/recall projections SHALL retain their existing private-context exclusions.

#### Scenario: Another owner supplies a private source or anchor

- **WHEN** an authenticated caller supplies another owner's private Chat or an anchor outside the owned source
- **THEN** the request behaves as not found
- **AND** it commits no destination

#### Scenario: A visitor forks a public compacted Chat

- **WHEN** another user forks the source through the shared/public route
- **THEN** the copy contains only the public transcript projection
- **AND** it has no compactions, digest state, usage, or origin

#### Scenario: A complete owner fork is later shared

- **WHEN** a non-owner views that fork publicly or its content enters ordinary export/search projections
- **THEN** the existing projection allowlists still exclude private context
- **AND** complete owner copying has not widened any egress surface
