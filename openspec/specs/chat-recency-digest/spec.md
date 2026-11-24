# chat-recency-digest

## Purpose

The recency digest gives the assistant bounded awareness of the owner's other Chats through persisted context-rail snapshots and notices. Shared Chat rows include canonical Workspace affinity and bounded opening and latest visible-text excerpts.

## Requirements

### Requirement: Eligibility excludes the current chat, archived chats, and untitled chats

The digest SHALL exclude the chat it is rendered into, SHALL exclude archived chats, and SHALL omit any chat with no title. A chat's title SHALL be the eligibility gate: because titles are generated asynchronously, a chat becomes eligible when its title exists and not before, which yields exactly one first appearance per chat. An untitled chat SHALL NOT be rendered under a placeholder label.

Pinned entries SHALL be drawn only from pins whose item type is `chat`; pins targeting other item kinds SHALL be ignored.

#### Scenario: A newly created chat is not yet titled

- **WHEN** the digest is resolved while the owner has a very recent chat whose title has not yet been generated
- **THEN** that chat is absent from the digest
- **AND** no placeholder title is rendered for it

#### Scenario: Archived chats are withheld

- **WHEN** an owner has archived a chat that would otherwise fall within the recency cap
- **THEN** that chat is absent from the digest
- **AND** the recent list backfills with the next eligible unarchived chat

#### Scenario: The current chat never lists itself

- **WHEN** a chat's digest is rendered at any point in that chat's life, including after it has a title
- **THEN** the chat itself is absent from its own digest
- **AND** its own first user message never appears in its own system prompt

#### Scenario: A pinned project is not a pinned chat

- **WHEN** the owner has pinned a project as well as chats
- **THEN** only pinned chats appear in the pinned list
- **AND** the pinned project contributes no entry

#### Scenario: An ineligible pinned chat is absent from the pinned denominator

- **WHEN** an owner has 12 pinned chats, of which one is archived, one has no title, and one is the chat being rendered
- **THEN** the rendered pinned ratio counts 9, not 12
- **AND** the same exclusions that removed those three from the list removed them from the count, so the ratio never names a pinned chat the digest could not have shown

### Requirement: Committed digest baselines remain stable until compaction

The producer MUST publish one baseline snapshot per enabled compaction epoch. Later requests MUST replay its stored text without re-resolution. Digest content MUST contribute no bytes to newly rendered system prompts or tool descriptions. Other prompt inputs MUST retain their own lifecycles.

A model switch MUST NOT refresh the baseline. A published checkpoint MUST start a new epoch for its next request. With sharing enabled, the producer MUST apply current selection rules.

With sharing disabled, it MUST carry only the frozen baseline, without accumulated notices or source reads. Its new comparison state MUST describe that baseline alone. A later attempt failure MUST preserve the checkpoint and companion. Retry MUST reuse both.

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

Unknown imported affinity MUST produce no correction until an enabled checkpoint refresh records a current binding. It MUST NOT trigger a first disclosure of historical Workspace roots.

Departures through displacement, archival, or deletion MUST produce no notice. Notices MUST use shared Chat rows for additions. Corrections MUST identify their source Chat and changed field without a full-list refresh.

One preparation MUST batch at most 20 corrections in Chat-id order. Advance comparison state only for included corrections. Deferred corrections MUST remain detectable next preparation. New entries retain their existing 20-row bound.

Co-occurring model changes and digest notices MUST remain separate items under the rail order. At an enabled checkpoint, a fresh snapshot MUST supersede prior digest items and state that fact. Disabled carry MUST retain only the frozen baseline without new supersession body text. Persisted items MUST remain immutable. The epoch MUST have no accumulated notice-count cap.

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

- **WHEN** an enabled checkpoint starts a new digest epoch with a freshly resolved baseline
- **THEN** its companion snapshot states that earlier digest updates are superseded
- **AND** the full baseline appears on the rail, not in the system prompt

### Requirement: Digest content is framed as data and cannot forge its own structure

Each digest snapshot and notice MUST use the packaged producer template, canonical rail envelope, provenance statement, and untrusted-content notice. The item MUST state that it describes the owner's other Chats as point-in-time data. It MUST rank below system instructions and owner requests. It MUST grant no tools, permissions, or higher authority. The item MUST restate ordinary instruction precedence after its data.

Persisted digest text MUST name no retrieval tool. Its locators MUST remain inert data and grant no permission or promise of tool availability.

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

`shareRecentChats` MUST remain opt-in and off by default. Disabled sharing MUST prevent fresh baseline resolution and new notices. Existing effective items MUST replay unchanged.

Disabled compaction MUST carry only the frozen baseline into a separate snapshot. It MUST NOT query source Chats or introduce new titles, excerpts, locators, or Workspace changes. Prior notices MUST leave the effective epoch. Without a prior baseline, publish no disabled snapshot.

Re-enabling MUST resume comparison against effective disclosed state. Without an effective baseline, the next enabled dispatch MUST establish one. No request can receive a delta before its baseline.

The producer MUST recheck consent after resolution and before fenced publication. Withdrawal MUST discard fresh candidates without failure. During checkpoint publication, that race MUST select the disabled frozen-baseline carry instead. Later setting changes MUST NOT rewrite committed disclosure.

Operator templates MUST NOT gate production or replay. New system prompts and tool descriptions MUST contain no digest content.

#### Scenario: Setting is disabled and the chat has no baseline

- **WHEN** a chat's first run happens while its owner's `shareRecentChats` setting is off
- **THEN** no baseline is resolved, and no digest content, framing prose, or delimiter appears in the effective prompt
- **AND** no digest append is emitted on any turn of that chat

#### Scenario: Setting is disabled after a chat already carries a baseline

- **WHEN** the owner disables sharing after a baseline snapshot exists
- **THEN** existing digest items replay unchanged and new notices stop
- **AND** compaction carries only the frozen baseline, not its notices, without source reads

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

The cutover MUST convert provable baseline fields and known literal digest items before it deletes the three dedicated Chat columns. It MUST query no source Chat to enrich old rows. It MUST preserve messages, parts, and receipts.

It MUST omit unprovable derived disclosure and privately report each affected Chat and field. Missing proof MUST NOT block other Chats. Unknown identity or affinity MUST NOT become a guess. Runtime MUST retain no old-column reader.

#### Scenario: Disabled sharing survives conversion

- **WHEN** a Chat has prior digest disclosure and sharing is off
- **THEN** conversion retains only accounted old text and comparison state
- **AND** no new locator, excerpt, or Workspace root enters its carried text

#### Scenario: Unprovable fields do not block the whole migration

- **WHEN** a receipt is absent, a description was runtime-only, or a duplicate title prevents safe field attribution
- **THEN** migration omits only the unprovable derived fields and privately reports the affected Chat
- **AND** it preserves messages, parts, known literal items, and historical receipts

### Requirement: Digest conversion uses only proved field emissions

The reader layer MUST export field-level emissions while its old renderer exists. The converter MUST verify owner and destination Chat identity before import. A baseline or told-set MUST NOT prove every text field's disclosure. Conversion MUST add no Chat locator, latest excerpt, or Workspace root. It MUST infer no identity from duplicate titles. SQL column deletion MUST follow the separate converter, not invoke a renderer.

#### Scenario: A title-only template proves no excerpt

- **WHEN** the old template emits only a title and checks an excerpt as a condition
- **THEN** export proves only the title field
- **AND** migration does not emit the stored excerpt

### Requirement: Imported comparison state requires emission proof

Each imported comparison id and pin state MUST have destination-bound proof of actual emission. A stored told-set alone MUST prove neither. Without that proof, omit and privately report the entry.

#### Scenario: An unproved told id remains eligible

- **WHEN** an old told-set contains an id without proved emission to the destination Chat
- **THEN** conversion omits that comparison entry and privately reports it
- **AND** the id remains eligible for an ordinary addition when sharing is enabled

### Requirement: Imported digest baselines precede historical notices

Conversion MUST append a host snapshot for proven baseline fields, associated with the active checkpoint or Chat origin. Replay MUST place it at epoch start before notices. A latest content-free notice can preserve trusted comparison state. It MUST record the latest pre-conversion turn and logical cutoff for retry and fork selection. It MUST NOT supersede old literal notices. Old items without current-format state MUST remain replayable and inert for comparison.

#### Scenario: An old pin correction remains the last word

- **WHEN** the frozen baseline lists a Chat as recent and a later literal notice pins it
- **THEN** the imported baseline replays before that pin notice
- **AND** the latest imported comparison state retains the known pin state without re-emitting the list

### Requirement: Disabled carry has one bounded canonical envelope

Disabled compaction MUST preserve only the baseline body and its comparison state. It MUST remove the validated code-owned outer envelope and provenance line before it authors one fresh envelope and provenance line. It MUST preserve body bytes and change no source item. It MUST NOT nest envelopes, carry accumulated notices, or grow wrapper text on repeated compaction. This author-time transform MUST NOT change ordinary replay.

#### Scenario: Repeated disabled compaction remains bounded

- **WHEN** a disabled Chat with one baseline and many notices crosses two checkpoints
- **THEN** each companion carries only the same frozen baseline body under one envelope
- **AND** the companion excludes notices while the summary instruction requests their exclusion without a structural guarantee

#### Scenario: Withdrawal during checkpoint preparation preserves the baseline

- **WHEN** sharing becomes disabled after fresh candidate resolution but before checkpoint publication
- **THEN** publication discards that candidate and carries the previous frozen baseline
- **AND** it performs no source read for the carry

### Requirement: Column deletion requires transactional conversion evidence

The converter and SQL deletion MUST use one advisory-locked transaction. Conversion MUST account for every legacy Chat, including omissions, and verify export identity and old-column fingerprints. It MUST set a transaction-local witness only after complete accounting. SQL MUST require that witness unconditionally before column deletion. A fresh schema MUST also establish it from catalog-proved absence of the legacy table, not an RLS-filtered empty scan. No persistent producer table is permitted.

#### Scenario: All fields are unprovable

- **WHEN** conversion omits every derived field for one Chat
- **THEN** its omission is privately reported and included in transaction-local completion accounting
- **AND** other Chats convert and SQL can safely complete without a fabricated Run or context item

#### Scenario: The converter is skipped

- **WHEN** SQL reaches digest column deletion without the transaction-local completion witness, regardless of visible row count
- **THEN** the migration rolls back without dropping columns

#### Scenario: An export is stale or misbound

- **WHEN** an export's owner, destination, or old-column fingerprint does not match
- **THEN** the converter omits and privately reports that Chat's unprovable derived fields
- **AND** it imports no misbound text and continues accounting for other Chats

#### Scenario: Imported affinity is unknown

- **WHEN** a migrated announced Chat has unknown historical affinity and is currently bound
- **THEN** no Workspace correction is emitted before an enabled checkpoint refresh establishes a known binding
- **AND** unknown does not become a claimed historical `unbound` value

### Requirement: Conversion inventory and tenant scope remain complete

Conversion MUST discover legacy Chat ids and owners through the repository's transaction-bounded `NO FORCE` migration pattern under an exclusive table lock. It MUST restore `FORCE` before owner-scoped content access. Each import MUST use its trusted owner identity. Before pending SQL migrations, conversion MUST reset that identity to empty and verify the reset. It MUST NOT grant a bypass role or leave weaker RLS after commit.

#### Scenario: Private rows cannot hide a skipped converter

- **WHEN** a legacy private Chat exists and a tenant-free SQL scan sees no rows
- **THEN** absent conversion evidence still blocks column deletion
- **AND** an RLS-filtered count cannot establish a fresh database

#### Scenario: SQL runs without the last imported owner

- **WHEN** conversion finishes imports for several owners and invokes pending SQL migrations
- **THEN** the SQL runner observes empty tenant identity, not the last imported owner
- **AND** a negative backfill check proves no owner scope leaked into migration execution

#### Scenario: Inventory restores forced isolation

- **WHEN** conversion enumerates legacy destination ids and owners
- **THEN** the exclusive-lock inventory window restores forced RLS before content access and commit
- **AND** a failure rolls back the window and every import
