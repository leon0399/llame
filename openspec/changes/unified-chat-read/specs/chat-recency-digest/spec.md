## REMOVED Requirements

### Requirement: The digest carries four bounded fields per chat and no identifier

**Reason**: The shared Chat row now carries locators, Workspace affinity, and two excerpts.

**Migration**: Use the shared row requirements of conversation-reads. Preserve existing disclosure as literal carry text.

### Requirement: Digest baselines publish with the successful attempt and disclosure state with the dispatched request

**Reason**: Rail-only disclosure publishes at dispatch, not successful completion. Dedicated columns no longer exist.

**Migration**: Persist a baseline snapshot before model I/O and derive comparison state from effective items.

### Requirement: The owner can inspect system-prompt digest text and committed appends

**Reason**: New digest content no longer enters system prompts or descriptions.

**Migration**: Inspect persisted owner-only context items. Preserve old receipts without rewriting them.

## MODIFIED Requirements

### Requirement: Committed digest baselines remain stable until compaction

The producer MUST publish one baseline snapshot per enabled compaction epoch. Later requests MUST replay its stored text without re-resolution. Digest content MUST contribute no bytes to newly rendered system prompts or tool descriptions. Other prompt inputs MUST retain their own lifecycles.

A model switch MUST NOT refresh the baseline. A published checkpoint MUST start a new epoch for the request it precedes. With sharing enabled, the producer MUST apply the current eligibility, caps, order, and disjointness rules. With sharing disabled, it MUST carry only prior disclosed state without source reads. A failure after publication MUST preserve the checkpoint and its companion snapshot. A retry MUST reuse both.

Earlier receipts and persisted items MUST remain unchanged. Owner forks MUST derive their baseline and disclosure from the copied effective prefix, not source state after the selected anchor.

#### Scenario: Second turn in a chat reuses the baseline

- **WHEN** a second request follows a persisted baseline and other prompt inputs stay unchanged
- **THEN** the request replays the same stored digest snapshot
- **AND** its distinct system-only receipt contains no new digest text

#### Scenario: A changed non-digest input has a fresh receipt

- **WHEN** owner inputs, the selected template, or admitted membership changes
- **THEN** the worker records its current system prompt in a fresh receipt
- **AND** the same digest snapshot remains on the rail until compaction

#### Scenario: Compaction refreshes the listed chats

- **WHEN** an enabled Chat publishes a checkpoint
- **THEN** a separate companion snapshot carries the newly selected baseline
- **AND** the next request receives it immediately after the checkpoint

#### Scenario: Model switch preserves the listed chats

- **WHEN** the owner switches models without a checkpoint
- **THEN** the model receives the same stored digest snapshot
- **AND** ordinary digest notices can still describe independent source changes

#### Scenario: An earlier run's receipt is not rewritten

- **WHEN** a baseline is re-resolved at compaction
- **THEN** earlier system-only receipts still disclose any digest their system prompt actually carried
- **AND** no earlier receipt is mutated to claim content it did not send

#### Scenario: Owner continues a fork

- **WHEN** an owner continues a fork with copied digest items
- **THEN** the producer derives disclosure only from the copied effective prefix
- **AND** later notices affect only the fork

### Requirement: Changes after the baseline are appended as events, never as a restated list

Within an epoch, the producer MUST append notices rather than restate the baseline. A notice MUST describe a newly announced Chat, a pin change, or a Workspace change. Derive events from the latest effective comparison state, not timestamps.

New entries MUST come only from the current top-10 pinned and top-10 recent views, minus announced ids. Pin corrections MUST inspect already-announced ids against actual owner pin membership. A capped-list displacement MUST NOT imply an unpin. An untold Chat MUST NOT enter through a correction. A Chat that returns to a capped view MUST qualify as a new entry if no prior item announces it.

Workspace corrections MUST compare stored canonical bindings of already-announced, still-owned, non-archived Chats. No source Machine probe is permitted. Unknown historical affinity MUST differ from known `unbound`. A title, excerpt, activity, or Run-status change alone MUST produce no notice.

Departures through displacement, archival, or deletion MUST produce no notice. Notices MUST use shared Chat rows for additions. Corrections MUST identify their source Chat and changed field without a full-list refresh.

One preparation MUST batch at most 20 corrections in Chat-id order. Advance comparison state only for included corrections. Deferred corrections MUST remain detectable next preparation. New entries retain their existing 20-row bound.

Co-occurring model changes and digest notices MUST remain separate items under the rail order. At a checkpoint, a new snapshot MUST supersede prior digest items and state that fact. Its full baseline is a checkpoint exception, not a notice. Persisted items MUST remain immutable. The epoch MUST have no accumulated notice-count cap.

#### Scenario: A new chat becomes eligible mid-conversation

- **WHEN** another owned Chat gains a title during the current Chat
- **THEN** the next run in the current chat carries an append naming that chat with its title, date, message count, and capped excerpt
- **AND** the system prompt is unchanged

#### Scenario: An old chat resurfaces

- **WHEN** a chat that was below the cap at baseline time receives a new message and re-enters the eligible view
- **THEN** an append is emitted for it on the same footing as a newly titled chat
- **AND** it is not silently skipped for having gained no title

#### Scenario: An already-told chat does not repeat

- **WHEN** an announced Chat remains eligible without a pin or Workspace change
- **THEN** no notice repeats it
- **AND** comparison uses the latest effective item, not only the baseline

#### Scenario: Displacement produces nothing

- **WHEN** new eligible Chats push an announced Chat beyond the recency cap
- **THEN** no append is emitted about the displaced chat
- **AND** the baseline continues to list it

#### Scenario: A newly pinned chat displaces another from the rendered list

- **WHEN** the owner pins a chat and that pushes a previously rendered pinned chat past the cap
- **THEN** an append is emitted for the newly pinned chat
- **AND** no append claims the displaced chat was unpinned, because it is still pinned

#### Scenario: An untold pinned chat is unpinned

- **WHEN** the owner unpins a pinned chat that was beyond the cap and never announced
- **THEN** no append is emitted, because the effective comparison state holds no pin state for it
- **AND** it can later enter through the ordinary eligibility path

#### Scenario: Owner unpins a chat

- **WHEN** the owner unpins an already-announced Chat
- **THEN** the next preparation includes its pin correction within the bounded batch
- **AND** earlier items remain unchanged

#### Scenario: Owner deletes a chat

- **WHEN** the owner deletes a chat that the digest listed
- **THEN** no append is emitted about the deletion, because a departure from the eligible view produces nothing
- **AND** the chat stops appearing in baselines resolved after that point

#### Scenario: A delta and a model switch coincide

- **WHEN** a run is enqueued that both switches models and carries a pending digest event
- **THEN** the effective-context-change item and the digest append are both emitted
- **AND** neither is suppressed, merged, or reordered relative to the order the `context-injection` capability specifies

#### Scenario: Compaction emits a supersession marker

- **WHEN** a checkpoint starts a new digest epoch
- **THEN** its companion snapshot states that earlier digest updates are superseded
- **AND** the full baseline appears on the rail, not in the system prompt

### Requirement: Digest content is framed as data and cannot forge its own structure

Each digest snapshot and notice MUST use the packaged producer template, canonical rail envelope, provenance statement, and untrusted-content notice. The item MUST state that it describes the owner's other Chats as point-in-time data. It MUST rank below system instructions and owner requests. It MUST grant no tools, permissions, or higher authority. The item MUST restate ordinary instruction precedence after its data.

Titles and excerpts MUST use the reserved-delimiter neutralization rules of instance-config. A value MUST NOT close a tag outside that value or forge a reserved delimiter. Rendered text MUST NOT undergo another template evaluation. Model compliance enforces semantic precedence. Delimiter integrity remains structural. Operator system-template overrides MUST NOT remove this packaged framing.

#### Scenario: A chat title contains instruction-shaped text

- **WHEN** a listed chat's title or excerpt contains text instructing the assistant to ignore prior instructions
- **THEN** it renders as content inside the block
- **AND** digest text changes no admitted tool id, schema, classification, or execution authority

#### Scenario: An excerpt attempts to close the block

- **WHEN** a listed chat's excerpt contains the block's closing delimiter, which the excerpt itself never opened
- **THEN** the delimiter is escaped as content and the block is not terminated early
- **AND** the rendered prompt contains exactly one delimiter pair

#### Scenario: The block restates instruction-following on exit

- **WHEN** a digest snapshot or notice renders
- **THEN** its packaged text frames the data and restates instruction precedence
- **AND** the stored context item preserves both parts

### Requirement: The digest is owner-scoped, and the setting gates production of digest state

The producer MUST read only the trusted owner's Chats under owner RLS and explicit owner predicates. Empty identity MUST fail closed. Public shares and shared forks MUST expose no digest or comparison state.

`shareRecentChats` MUST remain opt-in and off by default. Disabled sharing MUST prevent fresh baseline resolution and new notices. Existing effective items MUST replay unchanged. Compaction while disabled MUST carry only already-disclosed digest state into a separate rail snapshot. It MUST NOT query source Chats or introduce fresh titles, excerpts, locators, or Workspace changes. No prior digest means no disabled snapshot.

Re-enabling MUST resume comparison against effective disclosed state. If no effective baseline exists, the next dispatch with sharing enabled MUST establish one. A model request MUST NOT receive a delta before its baseline. The producer MUST recheck consent after candidate resolution and before its fenced publication. A withdrawal before that check MUST discard new candidates without failure. A setting change after publication MUST affect later production, not rewrite committed disclosure.

Operator templates MUST NOT gate production or replay. New system prompts and tool descriptions MUST contain no digest content.

#### Scenario: Setting is disabled and the chat has no baseline

- **WHEN** a chat's first run happens while its owner's `shareRecentChats` setting is off
- **THEN** no baseline is resolved, and no digest content, framing prose, or delimiter appears in the effective prompt
- **AND** no digest append is emitted on any turn of that chat

#### Scenario: Setting is disabled after a chat already carries a baseline

- **WHEN** the owner disables sharing after a baseline snapshot exists
- **THEN** existing digest items replay unchanged and new notices stop
- **AND** compaction carries only prior disclosure without source reads

#### Scenario: Public read of a shared chat

- **WHEN** an unauthenticated caller views a chat whose visibility is public
- **THEN** no digest content is reachable through that path
- **AND** the owner's other chat titles and excerpts are not disclosed

#### Scenario: One owner's digest never contains another owner's chats

- **WHEN** the row-level-security suite resolves a digest with another user's identity set, and again with the empty identity
- **THEN** no other owner's chats are readable
- **AND** no title or excerpt is disclosed

#### Scenario: Operator template omits the block

- **WHEN** a valid operator system prompt contains no digest paths
- **THEN** the digest still uses its packaged rail template
- **AND** template omission cannot suppress its framing

### Requirement: Enabling reaches backwards, withdrawal does not reach forwards, and both are disclosed

Enabling `shareRecentChats` MUST make existing eligible Chats available immediately, including their bounded excerpts and Workspace affinity. Disabled sharing MUST stop new baseline resolution and notices, not erase earlier disclosure.

Deleting or archiving a source Chat MUST exclude it from future selection. It MUST NOT redact earlier digest text, read observations, or receipts in another Chat. Disabled compaction MUST preserve prior disclosure without new source reads. The API contract and the setting interface MUST disclose retroactive enablement, non-retroactive withdrawal, and non-erasing deletion. They MUST NOT describe these operations as erasure.

#### Scenario: Owner enables the setting for the first time

- **WHEN** an owner with an existing corpus turns `shareRecentChats` on
- **THEN** the next chat they create lists chats that predate the setting being enabled, including their opening excerpts
- **AND** the setting interface discloses that retroactive reach

#### Scenario: Owner disables the setting mid-chat

- **WHEN** an owner turns `shareRecentChats` off while chats that already carry a digest remain open
- **THEN** those chats continue to send their bound baseline
- **AND** no further appends are emitted in them, and newly created chats carry no digest

#### Scenario: Owner deletes a chat that other chats listed

- **WHEN** an owner deletes a chat whose title and excerpt appear in another chat's bound digest
- **THEN** baselines resolved after the deletion omit it
- **AND** the other chat's already-bound prompt and receipts still contain it

### Requirement: Digest rail items persist their author-time projection

Every digest snapshot and notice MUST persist its complete final model-facing text before the request that carries it. It MUST also persist producer, form, Run linkage, and validated comparison metadata. Ordinary publication MUST share the fenced dispatch transaction. A checkpoint companion MUST share checkpoint publication instead.

Replay MUST use stored text verbatim and in effective-context order. It MUST NOT regenerate historical titles, excerpts, Workspace affinity, or framing from metadata. Renderer changes MUST affect only new items. A metadata-only historical item MUST remain inert. The producer MUST derive told state from its effective nonempty items, including committed input of a retry. It MUST NOT keep producer-specific columns or tables.

#### Scenario: A renderer changes after an append was written

- **WHEN** an existing chat containing a persisted digest append is replayed after its producer wording changes
- **THEN** the append's complete stored text and position remain unchanged
- **AND** newly authored appends can use the new text

#### Scenario: A source chat changes after an append was written

- **WHEN** a source title, excerpt, or Workspace changes after a notice persists
- **THEN** the stored notice remains unchanged
- **AND** replay reads no source Chat to rebuild it

#### Scenario: A data-only digest part is replayed

- **WHEN** an existing digest part carries semantic payload but no complete text
- **THEN** it contributes no model-visible block
- **AND** no source-chat content is re-read to backfill it

## ADDED Requirements

### Requirement: Digest rows reuse the shared owner Chat row

Each newly resolved digest row MUST use the shared Chat row of conversation-reads, including its locator, Workspace affinity, and two bounded excerpts. The digest MUST retain the 10-pinned and 10-recent caps, disjoint lists, pin-rank order, and recent backfill. It MUST preserve eligible shown/total ratios, absolute compilation date, and point-in-time framing. It MUST contain no Run status or other activity telemetry.

#### Scenario: A digest entry is directly readable

- **WHEN** a baseline lists another owned Chat
- **THEN** its row contains a `chat://` locator that read accepts

#### Scenario: A long corpus keeps its caps

- **WHEN** the owner has 30 eligible pinned and 217 eligible unpinned Chats
- **THEN** the snapshot shows at most 10 of 30 pinned and 10 of 217 recent

#### Scenario: The shared row does not imply fresh state

- **WHEN** an announced Chat changes its title or latest reply
- **THEN** the existing row stays unchanged until an ordinary event or checkpoint refresh

### Requirement: An enabled epoch starts with one dispatched snapshot

The first enabled dispatch of an epoch MUST persist one baseline snapshot before model I/O. Its payload MUST identify every row it actually discloses. An empty corpus MUST produce an empty baseline snapshot. A failure before publication MUST establish no disclosure. A failure after publication MUST keep it. Retry, Continue, and Regenerate MUST compare against effective stored items and avoid duplicate snapshots.

#### Scenario: A failed dispatched attempt keeps its baseline

- **WHEN** an attempt dispatches its baseline and then fails
- **THEN** the next attempt reuses the stored snapshot without resolving a second baseline

#### Scenario: A pre-dispatch failure changes nothing

- **WHEN** an initializing attempt fails before its publication transaction commits
- **THEN** no baseline item or comparison state persists

#### Scenario: Empty baseline does not repeat

- **WHEN** an enabled epoch has no eligible source Chat
- **THEN** one empty baseline snapshot persists and later preparations compare against it

#### Scenario: A retry does not duplicate an item

- **WHEN** an earlier attempt persists its baseline on the triggering message
- **THEN** the retry replays it once and derives only new events

### Requirement: Workspace-only changes produce bounded notices

An enabled preparation MUST compare canonical Workspace bindings for already-announced owned Chats. A changed binding MUST produce a correction notice within the bounded batch. The correction MUST distinguish entry, switch, and exit through the old and new binding values. It MUST NOT restate the full digest, probe a Machine, or attach Run status. Comparison state MUST advance only with the persisted correction.

#### Scenario: A source Chat switches Workspace

- **WHEN** an announced Chat changes its binding without a pin or message change
- **THEN** the receiving Chat next preparation produces a Workspace correction

#### Scenario: A deferred correction remains detectable

- **WHEN** more than 20 corrections await one preparation
- **THEN** the next preparation can still detect each correction that no prior item disclosed

#### Scenario: Workspace exit is not an unknown value

- **WHEN** a known bound Chat becomes unbound
- **THEN** the correction explicitly records `unbound`

### Requirement: The owner inspects digest items rather than new prompt receipts

New digest text MUST be inspectable through the owner's persisted context items. New system-only receipts MUST contain no digest contribution. Historical receipts MUST remain unchanged. Public inspection, logs, and error responses MUST expose no digest text or comparison state. Resolution failures MUST report safe failure kinds without titles, excerpts, or Workspace roots.

#### Scenario: An owner inspects new disclosure

- **WHEN** an owner inspects a dispatched baseline or notice
- **THEN** the stored item contains the exact sent text
- **AND** its system-only receipt does not claim to contain that item

#### Scenario: Resolution diagnostics are safe

- **WHEN** digest resolution fails
- **THEN** diagnostics contain a failure kind and no source content or Workspace root

### Requirement: Digest columns retire without silent disclosure loss

The cutover MUST convert safely accounted prior disclosure into persisted literal digest state before it deletes the three dedicated Chat columns. It MUST query no source Chat to enrich old rows. It MUST preserve historical parts and receipts. Unknown old affinity MUST NOT become `unbound`. If the converter cannot account for a baseline safely, it MUST abort before column deletion. Runtime MUST retain no old column reader.

#### Scenario: Disabled sharing survives conversion

- **WHEN** a Chat has prior digest disclosure and sharing is off
- **THEN** conversion retains only accounted old text and comparison state
- **AND** no new locator, excerpt, or Workspace root enters its carried text

#### Scenario: Ambiguous old disclosure aborts deletion

- **WHEN** a custom template or duplicate title prevents safe baseline accounting
- **THEN** the migration fails before it deletes any digest column
- **AND** the existing Chats and historical observations remain intact
