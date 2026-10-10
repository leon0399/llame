## RENAMED Requirements

- FROM: `### Requirement: Digest baseline and disclosure state publish with the successful attempt`
- TO: `### Requirement: Digest baselines publish with the successful attempt and disclosure state with the dispatched request`

## MODIFIED Requirements

### Requirement: Digest baselines publish with the successful attempt and disclosure state with the dispatched request

Each chat SHALL carry two distinct pieces of digest state, and they SHALL NOT be conflated:

- The **rendered baseline** — the capped, ordered entries available to both prompt surfaces. It is written once, with the chat's first successful turn whose attempt prepared it with the setting enabled, and is **immutable until re-resolution**, which keeps the digest contribution stable across the chat's turns.
- The **told-set** — every chat this conversation has been told about in dispatched model context, whether through a rendered baseline in either prompt surface or a later append, with the pin state last communicated for each. It **grows** with every append.

Both SHALL be reset together when the baseline is re-resolved at a checkpoint. The refresh SHALL be published with that checkpoint, in the same transaction, before the model step the checkpoint precedes; it SHALL not pretend the refreshed baseline was already disclosed by that step. The new epoch's told-set SHALL include only entries actually disclosed by a dispatched request, so a refresh awaiting its first request starts with no newly disclosed entries.

The told-set SHALL record only chats the model actually received. Initialization SHALL therefore derive it from the baseline actually **rendered** in the winning attempt's system prompt or admitted tool descriptions, not merely from the fact that baseline state was written: operator templates that omit the digest from both surfaces leave the baseline unrendered, and marking those chats told would suppress their later appends and disclose them never. A chat whose baseline entry was never rendered SHALL remain untold, so it enters through the ordinary append path when the ordinary append rules make it eligible.

Both prompt renders SHALL return private disclosure metadata alongside text, keyed to the trusted digest candidates. Record entry ids only when their entry values are actually emitted along the executed template branch, not when a collection is tested/iterated or only aggregate counts are emitted. Use the existing validated renderer's emission path, not string matching, reparsing rendered text, or a second template engine. These ids SHALL not become new template variables or stored tool-description metadata. Use the union of prior told state and the current render's actual baseline disclosure when deriving this attempt's appends; commit that union plus the request's digest appends in the attempt's dispatch transaction, whether or not the request carries a digest item, whatever the Run's outcome; a chat's initial baseline and told-set still commit only with the winning turn.

A checkpoint refresh SHALL reset the new epoch's told-set without pre-marking unrendered entries; the next dispatched request accounts for actual baseline disclosure. Unrendered entries remain eligible under the ordinary append rules.

The told-set SHALL identify chats by their chat id. Storing an identifier for bookkeeping is not in tension with omitting identifiers from the rendered output: the two serve different purposes, and no stored id is ever rendered.

The worker SHALL recheck the owner setting and chat digest epoch under tenant scope immediately before preparing the final request and system-only receipt, after candidate resolution. If sharing was disabled during resolution, discard the new baseline/append candidate and proceed without newly produced digest content. This check SHALL occur before target-model I/O, not after disclosure. A checkpoint's re-resolved baseline commits in the checkpoint's own fenced transaction, which precedes the final request, so for that candidate the recheck SHALL run inside that transaction, after candidate resolution and before the refreshed baseline is written; a withdrawal before that point discards the candidate and the checkpoint publishes without the digest refresh. Existing baseline retention on withdrawal remains unchanged.

Baseline/told-set initialization SHALL be staged for the attempt and committed atomically with its successful turn; it is the only digest state that waits for a successful turn. Append advancement, and an existing epoch's told-set accounting for the request's actual baseline disclosure, SHALL commit in the attempt's fenced dispatch transaction, the one that persists the request's accepted-turn items on their message before that request is dispatched, whether or not the request carries a digest item, whatever the Run's later outcome. A checkpoint SHALL publish its refreshed baseline and reset told-set in its own fenced atomic transaction under `model-system-prompts`, before the model step it precedes. Failed, cancelled, or superseded attempts SHALL leave the committed digest state unchanged beyond what their dispatch transactions committed: an attempt that ends before its dispatch transaction commits changes nothing, a failed initializing attempt leaves no baseline, told-set advancement already committed with a dispatched append remains because that append remains in history, and a checkpoint already published with its refreshed baseline survives the failure of the attempt it preceded, because the checkpoint and its epoch state describe committed history only and a retry reuses them rather than re-resolving. At most one baseline epoch SHALL exist per chat; existing single-flight and attempt/epoch fencing SHALL prevent competing initialization or a stale compaction candidate from overwriting current state.

A setting change after request preparation applies to later attempts; it cannot undo content already sent. The dispatch transaction SHALL record the actual prepared disclosure rather than pretending a later withdrawal prevented it. Receipts and committed content retain the existing non-erasure contract.

Detecting events SHALL NOT require re-reading the chat's persisted message parts to reconstruct what was already announced; the told-set is the record. The told-set SHALL be advanced **in the same transaction as the append it accounts for**, so a run that fails to persist cannot leave the conversation marked as having been told something it never received. Because that transaction is the one that dispatches the request, a Run that fails after dispatch keeps both the append and the advancement, and the next Run does not announce the same event again. A request that carries no append still commits its actual baseline disclosure in that transaction.

#### Scenario: Baseline stays fixed while the told-set grows

- **WHEN** several appends are emitted over a chat's life
- **THEN** the rendered baseline is byte-identical throughout
- **AND** the told-set contains the baseline's chats plus every appended chat

#### Scenario: Re-resolution resets both

- **WHEN** the baseline is re-resolved at a checkpoint
- **THEN** the new epoch replaces the old told-set and records only actual disclosure of the fresh baseline by a dispatched request
- **AND** the request prepared after that publication accounts for entries rendered in either prompt surface before deriving appends, so that same request does not re-announce them

#### Scenario: A failed attempt leaves the refreshed epoch in place

- **WHEN** a checkpoint published a refreshed baseline before a model step and that attempt then failed
- **THEN** the refreshed baseline and its reset told-set remain committed
- **AND** the retry reuses them rather than resolving another baseline

#### Scenario: Concurrent initializing sends produce one baseline

- **WHEN** two initializing sends for the same chat race, both with the setting enabled
- **THEN** exactly one baseline epoch exists afterwards
- **AND** the losing request aborts or retries against the winner's baseline rather than publishing a competing baseline from its own candidate

#### Scenario: Owner re-enables the setting for a chat that has no baseline

- **WHEN** an owner turns `shareRecentChats` back on for an ongoing chat whose runs all happened while it was off
- **THEN** the next successful turn prepared with sharing enabled initializes the baseline and told-set atomically
- **AND** no append is emitted before that baseline exists

#### Scenario: The setting is disabled between resolution and request preparation

- **WHEN** an owner disables `shareRecentChats` after the worker has resolved a baseline candidate but before its final pre-request owner-setting check, and before any checkpoint transaction has published that candidate
- **THEN** the candidate is discarded and no new baseline or append is sent or committed
- **AND** the run proceeds without digest content rather than failing

#### Scenario: Sharing is withdrawn after checkpoint publication

- **WHEN** an owner disables `shareRecentChats` after a checkpoint transaction has published a refreshed baseline but before the final pre-request owner-setting check
- **THEN** the request proceeds without newly produced digest content
- **AND** the published checkpoint and refreshed baseline remain committed

#### Scenario: A failed attempt leaves no baseline

- **WHEN** an initializing attempt resolves a baseline but does not successfully complete
- **THEN** no baseline or told-set state persists for that chat
- **AND** a permitted retry or later Run resolves the baseline afresh

#### Scenario: A failed run does not advance the told-set

- **WHEN** an append is prepared but its attempt fails before the dispatch transaction that persists it commits
- **THEN** the told-set is unchanged and the append is not in history
- **AND** the same event is detected again on the next run

#### Scenario: A failed run keeps the told-set its dispatched append advanced

- **WHEN** an append is persisted and the told-set advanced in the dispatch transaction, and the Run then fails, is cancelled, or expires
- **THEN** the append remains in history and the told-set still records it
- **AND** the next run does not announce the same event again

#### Scenario: A retry reuses the dispatched append

- **WHEN** an attempt persisted an append at dispatch and then failed, and a retry of the same Run prepares its request
- **THEN** the retry replays the stored append unchanged and in place
- **AND** it derives appends against the told-set that dispatch advanced, so it derives no second append for the same event

#### Scenario: The first request after a checkpoint refresh records disclosure without an append

- **WHEN** a checkpoint published a refreshed baseline, the next request renders some of its entries in a prompt surface and derives no append, and that request is dispatched
- **THEN** the request's dispatch transaction records the rendered entries in the new epoch's told-set although the request carries no digest item
- **AND** if the Run then fails, is cancelled, or expires, that accounting remains and the next Run does not append those entries

#### Scenario: A tool description is the only baseline disclosure

- **WHEN** the successful attempt's system template omits the digest but an admitted tool description renders it
- **THEN** the told-set accounts for the baseline entries actually disclosed through that description
- **AND** the tool description itself is not persisted in a receipt

#### Scenario: Sharing is withdrawn after the prepared request

- **WHEN** sharing is disabled after the attempt's pre-request check and that attempt's request is dispatched
- **THEN** the digest state committed for that request records the digest actually sent under the checked setting
- **AND** later attempts obey withdrawal without rewriting existing receipts or committed content
