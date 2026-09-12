## Purpose

Allow an authenticated owner to create an independent conversation from a selected prefix of their own history, preserving its pinned context, compaction state, and inspectable evidence without executing the copied turns or widening public disclosure.

## ADDED Requirements

### Requirement: The owner selects an atomic historical boundary

The owner SHALL be able to fork their own Chat as a whole or through an inclusive user or assistant message. The source, boundary, copied history, and continuation state SHALL be resolved from one consistent datastore snapshot and committed as one complete destination. The system SHALL copy the entire selected prefix without a message-count cap or partial-success response.

A whole-chat fork SHALL end at the last durably completed assistant turn visible in that snapshot. It SHALL exclude later user input, partial assistant output, tool observations, and continuation state belonging to an unfinished Run. A terminal status without its durable completed answer SHALL NOT establish a completed boundary. If no completed turn exists, a whole-chat fork SHALL create an empty private Chat.

An empty whole-chat fork SHALL inherit no context origin, digest, compaction, comparison baseline, or receipt state. It SHALL initialize as an ordinary new Chat and SHALL NOT fail for unavailable historical continuation state. Its first local turn SHALL begin the normal new-chat disclosure epoch; the non-empty inheritance rules do not apply to this empty prefix.

Assistant completion SHALL use the existing usage-based completion contract, including legacy absent usage, with no governing nonterminal Run. Completed answers salvaged under failed or expired terminal Runs SHALL remain eligible. A completed legacy assistant without a Run or reply link SHALL establish a non-empty assistant boundary; unavailable continuation evidence SHALL cause an explicit failure, never an empty-success substitution.

User-anchor completion SHALL be established by a proven completed reply or a retained source-independent completion fact. An unlinked assistant SHALL NOT establish completion for an arbitrary user. Unprovable legacy user-anchor completion SHALL return `409 fork_context_unavailable`; a copied completed user anchor SHALL remain eligible after its original answer and Run are absent.

An explicit anchor SHALL remain the requested message rather than be moved silently. A message belonging to an unfinished or retryable partial turn SHALL fail with `409 fork_boundary_unsettled` and create nothing. An absent source, foreign-owner source, or anchor outside the owned source Chat SHALL retain not-found behavior.

Both named conflicts SHALL use the existing domain-error body `{ statusCode: 409, error: "Conflict", code, message }`. OpenAPI SHALL declare the two stable code values so clients can distinguish them without matching human-readable wording.

#### Scenario: Whole-chat fork races an active Run

- **WHEN** `U1 A1` is complete and the source has accepted `U2` with an unfinished Run
- **THEN** the whole-chat fork contains exactly `U1 A1`
- **AND** it contains no `U2` input, partial response, tool output, or context changes

#### Scenario: An explicit user anchor is inclusive

- **WHEN** the completed source history is `U1 A1 U2 A2` and the owner selects `U2`
- **THEN** the fork contains exactly `U1 A1 U2`
- **AND** it remains idle without generating an answer to the copied `U2`

#### Scenario: An explicit assistant anchor is inclusive

- **WHEN** the completed source history is `U1 A1 U2 A2` and the owner selects `A1`
- **THEN** the fork contains exactly `U1 A1`

#### Scenario: The selected anchor is unfinished

- **WHEN** the requested user or assistant message belongs to an unfinished or retryable partial turn
- **THEN** the request returns `409 fork_boundary_unsettled`
- **AND** no destination Chat or copied row is committed

#### Scenario: No completed turn exists

- **WHEN** a whole-chat fork is requested before the source has any completed turn
- **THEN** the destination is an empty private Chat
- **AND** no unfinished input or model execution is inherited
- **AND** the first local turn uses the destination's creation time and normal new-chat context initialization

#### Scenario: A terminal failure retained a completed answer

- **WHEN** a failed or expired Run has a durable assistant projection classified as completed by the existing predicate
- **THEN** that answer remains eligible as a whole-chat cutoff or explicit assistant anchor
- **AND** its terminal status alone cannot cause an older cutoff

#### Scenario: A legacy assistant has no execution or reply link

- **WHEN** a legacy assistant with absent usage is the last completed message and has no retained Run or `inReplyTo`
- **THEN** it establishes a non-empty selected prefix without an invented user link or execution record
- **AND** unavailable continuation state fails explicitly rather than silently creating an empty Chat

#### Scenario: A legacy user has no provable completed reply

- **WHEN** an explicit legacy user anchor has unknown completion, no governing nonterminal Run, and neither a proven completed reply nor a retained completion fact
- **THEN** unavailable legacy completion evidence returns `409 fork_context_unavailable`
- **AND** a nearby unlinked assistant is not guessed to be its reply

#### Scenario: A large prefix spans several insertion batches

- **WHEN** the selected history exceeds a single bulk-insert batch
- **THEN** every selected message is copied in stored order
- **AND** a failure in any batch rolls back the whole fork

### Requirement: Inherited message content remains literal

The fork SHALL preserve copied roles, message parts and their order, attachments, sender attribution, timestamps, and historical usage. It SHALL allocate independent storage identities and preserve the relationships between copied messages. Only storage references necessary to establish the destination SHALL be remapped.

Model-visible text, tool-call identifiers, provider-visible identifiers, stored context-item text, and identifiers embedded in historical payloads SHALL remain verbatim. The copy SHALL NOT re-render, sanitize again, reorder, summarize, or re-budget inherited content. Referenced external resources SHALL NOT be copied or granted new authority merely because their locators occur in history.

#### Scenario: A tool result mentions the source Chat

- **WHEN** copied tool output includes source Chat identifiers and a tool-call ID
- **THEN** those payload values remain unchanged
- **AND** copied assistant replies reference the copied user messages through remapped storage relationships

#### Scenario: A formatter changed after the original turn

- **WHEN** an owner forks messages containing previously rendered context items
- **THEN** their original text and position are retained
- **AND** the current formatter does not regenerate them

### Requirement: Applicable compaction lineage remains replay authority

The fork SHALL preserve the compaction state applicable to the selected boundary, including its complete parent lineage, raw summaries, materialized replacement histories, original timestamps, and historical usage. Its coverage and lineage references SHALL address the copied history. A checkpoint whose authoring state depended on excluded messages SHALL NOT become applicable merely because its covered prefix ends before the selected message.

The fork's replay SHALL use the copied replacement history followed by the retained messages after its coverage boundary. It SHALL NOT rebuild a checkpoint from raw summary, repeat compaction during copying, or substitute uncompacted history when the required checkpoint is malformed. A malformed or unprovable required lineage SHALL fail atomically without a partial copy.

#### Scenario: The source has multiple compaction generations

- **WHEN** the selected boundary has an active checkpoint with two ancestors
- **THEN** the fork retains all three checkpoints with internal destination lineage
- **AND** its active replacement history and retained tail equal those selected from the source

#### Scenario: Coverage fits but a later turn triggered the checkpoint

- **WHEN** a checkpoint covers messages through 10 but was authored from state after message 18, and the owner selects message 15
- **THEN** the checkpoint is not inherited as the fork's active state
- **AND** the earlier boundary's recorded context remains authoritative

#### Scenario: Replacement history is malformed

- **WHEN** the required active checkpoint lacks valid non-empty replacement history
- **THEN** the fork fails without committing a destination
- **AND** it does not regenerate the checkpoint or silently discard compaction

#### Scenario: An ancestor carries excluded continuation state

- **WHEN** an otherwise selected lineage contains a recorded ancestor companion whose message horizon exceeds the requested boundary or whose revision exceeds the selected state
- **THEN** the operation fails atomically rather than importing that companion's excluded state
- **AND** it neither drops the required ancestor nor substitutes a different checkpoint

### Requirement: Pinned boundary state survives later source changes

The fork SHALL inherit the selected boundary's recorded context origin, digest baseline and told-set, re-bake state, model/tool comparison baseline, and immutable effective-context evidence. These values SHALL be selected together with the applicable compaction state. A later source update SHALL NOT replace them.

Stale but intact pinned state SHALL remain valid. The system SHALL NOT refresh it from today's source or corpus merely because the owner creates a fork. Known absent state SHALL remain distinct from unrecorded state. If required historical continuation state was never retained and cannot be established from recorded facts, the operation SHALL fail with `409 fork_context_unavailable` rather than invent state or treat unknown as empty. A genuinely absent historical receipt SHALL remain absent, not be replaced by another turn's receipt.

#### Scenario: Monday's state is forked on Wednesday

- **WHEN** Monday's retained boundary precedes Tuesday's digest refresh and later model change
- **THEN** the fork inherits Monday's pinned state and comparison baseline
- **AND** its age produces neither a refusal nor an automatic refresh or fork notice

#### Scenario: Later state belongs to an excluded active turn

- **WHEN** an unfinished source Run advanced the live told-set after the last completed turn
- **THEN** a whole-chat fork inherits the preceding boundary's told-set
- **AND** excluded disclosures cannot suppress future announcements in the fork

#### Scenario: A historical continuation record is genuinely missing

- **WHEN** a selected old boundary lacks required structured continuation evidence and no recorded facts establish it
- **THEN** the operation returns `409 fork_context_unavailable` and creates nothing
- **AND** no current baseline or guessed empty state is substituted

#### Scenario: Adoption observes an unfinished later turn

- **WHEN** adoption captures current state from `U1 A1 U2` at sequences 1/2/3 with unfinished U2
- **THEN** the adoption state has message horizon 3, even if the active checkpoint only covers sequence 1
- **AND** a fork at A1 returns `fork_context_unavailable` if no earlier recorded facts establish its required state

### Requirement: Ordinary continuation defines model-facing fidelity

Under identical continuation inputs and runtime versions, the fork SHALL produce the same inherited model-facing prefix as ordinary next-turn reconstruction of the selected source state. This includes the effective system-prefix inputs, applicable checkpoint, ordered retained history, model/tool comparison state, and cache-affecting declarations and provider options. Storage-only identity differences SHALL NOT enter that prefix.

Fork creation SHALL emit no model-facing notice, fresh disclosure baseline, assignment, or special instructions. Future real model, configuration, personalization, availability, consent, and corpus changes SHALL follow ordinary behavior. Historical snapshots SHALL NOT grant continued tool authority or prevent current authorization checks.

The comparison SHALL NOT require reproducing a prior in-flight provider request. The existing reasoning and assistant/tool replay policy SHALL remain unchanged. Exact application input SHALL maximize cache eligibility without promising a physical provider cache hit or adding provider cache controls.

#### Scenario: The first local turn uses unchanged inputs

- **WHEN** the fork and a boundary-equivalent source receive identical new input under identical continuation conditions
- **THEN** their inherited provider-facing prefix is equal through the ordinary serializer
- **AND** no difference arises solely from the fork's new storage IDs or creation time

#### Scenario: The owner genuinely changes models

- **WHEN** the next selected model differs from the model at the inherited boundary
- **THEN** the ordinary model-change behavior compares against that inherited model
- **AND** the fork does not pretend it has no previous model

#### Scenario: Tool availability is unchanged

- **WHEN** the fork's next turn has the same availability manifest and disclosure epoch as its inherited boundary
- **THEN** no fresh degraded-availability notice repeats solely because the Chat is new

#### Scenario: Reasoning was stored in an inherited assistant message

- **WHEN** ordinary next-turn reconstruction omits that reasoning under the current policy
- **THEN** reconstruction in the fork applies the same policy
- **AND** the fork does not introduce separate reasoning retention or removal behavior

### Requirement: Fork lifetime and execution are independent

The destination SHALL be a new private, unarchived Chat with the existing title-copy behavior and no inherited pin or Project membership. It SHALL survive source deletion and SHALL evolve independently after commit. Fork-of-fork SHALL preserve inherited content and origin attribution without needing any ancestor Chat.

Fork creation SHALL make no chat-model or compaction inference call and enqueue no executable Chat Run. It SHALL NOT copy event streams, active jobs, cancellation state, worker identity, or native-effect fences. Subsequent source execution SHALL never settle into the destination.

#### Scenario: The source is deleted

- **WHEN** the owner deletes the source after a successful fork
- **THEN** the fork's history, checkpoints, context receipts, and next-turn preparation remain available
- **AND** no surviving reference requires the deleted source Chat or Run

#### Scenario: A fork is forked again

- **WHEN** the owner forks a retained boundary from an existing fork
- **THEN** the new copy preserves the same historical evidence and origin identities
- **AND** deleting either ancestor cannot change it

#### Scenario: An inherited tool result describes a native write

- **WHEN** a copied assistant message contains a completed native mutation observation
- **THEN** it remains historical output only
- **AND** the fork does not copy its mutation fence or execute the write again

### Requirement: Historical evidence remains inspectable without double-counting spend

Owners SHALL be able to inspect copied timestamps, model/effort, usage, immutable effective-context receipts, and applicable checkpoint summaries using destination Chat/message identity. Receipt contents SHALL use the existing safe allowlist and load on demand. A receipt reference SHALL identify its recorded original Run within that owned message's history, preserving distinct retained historical receipts. An assistant receipt SHALL match its proven originating Run; ambiguous or inconsistent origin SHALL NOT resolve to another receipt. Ordinary continuation SHALL retain the existing message-sequence, acceptance-time, and original-Run-ID ordering, independently of explicit receipt inspection. Today's one-accepted-Run-per-user-message admission contract SHALL remain unchanged.

Copied usage SHALL retain its original execution identity and time, with an explicit distinction between inherited evidence and local execution. Owner message and compaction responses SHALL expose `usageProvenance` as `local`, `inherited`, or null for absent usage; the additional namespaced origin keys SHALL remain server-side. Fork creation SHALL create no spend event. Aggregation of retained evidence across originals and forks SHALL count one originating execution once, including fork-of-fork and compaction usage; local-only totals SHALL exclude inherited usage. This change SHALL NOT introduce an analytics endpoint or recover unrecorded provider costs. A historical fork ending at a user message SHALL expose its accepted context but SHALL NOT attach the excluded assistant's usage or later execution-only evidence.

#### Scenario: Owner opens a receipt after deleting the source

- **WHEN** the owner opens a copied message's context action after source deletion
- **THEN** its original safe prompt/tool receipt is available through the destination message
- **AND** the receipt does not contain host paths, credentials, or invented execution metadata

#### Scenario: A reused message ID is submitted again

- **WHEN** a caller submits an already accepted user message ID, including after cancellation
- **THEN** the existing admission conflict remains in force
- **AND** the request creates no new acceptance evidence or replacement receipt for that message

#### Scenario: Retained history contains several Runs for a message

- **WHEN** existing history retains distinct Run receipts for one user message
- **THEN** copying preserves each recorded origin and every control resolves the receipt it actually references
- **AND** an assistant cannot select a different Run's receipt, and continuation retains the existing deterministic tie-break
- **AND** retaining that history does not admit new same-message retries

#### Scenario: Several copies share one original execution

- **WHEN** one original turn is present in two forks and one fork-of-fork
- **THEN** each copy can show the historical usage as inherited
- **AND** the originating execution contributes once to aggregate spend

### Requirement: Owner-only fidelity never widens shared disclosure

Owner identity SHALL come from authenticated server context and SHALL be enforced in datastore reads and writes. All copied private context references SHALL remain same-owner and same-Chat where applicable. Missing identity or a foreign reference SHALL fail closed and SHALL commit nothing.

The shared/public fork path SHALL continue to copy only what its existing public response allows. It SHALL receive no private compaction, continuation state, receipt, usage, or source-owner metadata. Public views of an owner fork, ordinary exports, and search/recall projections SHALL retain their existing private-context exclusions.

#### Scenario: Another owner supplies a private source or anchor

- **WHEN** an authenticated caller supplies another owner's private Chat or an anchor outside the owned source
- **THEN** the request behaves as not found
- **AND** it commits no destination or private evidence

#### Scenario: A cross-owner snapshot reference is attempted

- **WHEN** a write tries to associate copied history with another owner's effective-context snapshot
- **THEN** datastore ownership enforcement rejects it
- **AND** no receipt or prompt data is disclosed

#### Scenario: Another Chat's checkpoint is referenced

- **WHEN** a write assigns a different Chat's compaction to an initial, accepted-turn, or checkpoint continuation state, even within the same owner
- **THEN** datastore reference constraints reject it
- **AND** neither replay nor receipt inspection can follow that foreign checkpoint

#### Scenario: A visitor forks a public compacted Chat

- **WHEN** another user forks the source through the shared/public route
- **THEN** the copy contains only the public transcript projection
- **AND** it has no compactions, private context parts, continuation state, receipts, or inherited usage

#### Scenario: A complete owner fork is later shared

- **WHEN** a non-owner views that fork publicly or its content enters ordinary export/search projections
- **THEN** the existing projection allowlists still exclude private context and receipt metadata
- **AND** complete owner copying has not widened any egress surface
