# Spec Delta

## MODIFIED Requirements

### Requirement: Digest baseline and disclosure state publish with the successful attempt

Each chat SHALL carry two distinct pieces of digest state, and they SHALL NOT be conflated:

- The **rendered baseline** — the capped, ordered entries available to both prompt surfaces. It is written once, with the chat's first successful turn whose attempt prepared it with the setting enabled, and is **immutable until re-resolution**, which keeps the digest contribution stable across the chat's turns.
- The **told-set** — every chat this conversation has been told about in successful model context, whether through a rendered baseline in either prompt surface or a later append, with the pin state last communicated for each. It **grows** with every append.

Both SHALL be reset together when the baseline is re-resolved at a checkpoint. The refresh SHALL be published with that checkpoint, in the same transaction, before the model step the checkpoint precedes; it SHALL not pretend the refreshed baseline was already disclosed by that step. The new epoch's told-set SHALL include only entries actually disclosed by a successful request, so a refresh awaiting its first request starts with no newly disclosed entries.

The told-set SHALL record only chats the model actually received. Initialization SHALL therefore derive it from the baseline actually **rendered** in the winning attempt's system prompt or admitted tool descriptions, not merely from the fact that baseline state was written: operator templates that omit the digest from both surfaces leave the baseline unrendered, and marking those chats told would suppress their later appends and disclose them never. A chat whose baseline entry was never rendered SHALL remain untold, so it enters through the ordinary append path when the ordinary append rules make it eligible.

Both prompt renders SHALL return private disclosure metadata alongside text, keyed to the trusted digest candidates. Record entry ids only when their entry values are actually emitted along the executed template branch, not when a collection is tested/iterated or only aggregate counts are emitted. Use the existing validated renderer's emission path, not string matching, reparsing rendered text, or a second template engine. These ids SHALL not become new template variables or stored tool-description metadata. Use the union of prior told state and the current render's actual baseline disclosure when deriving this attempt's appends; commit that union plus successful digest appends only with the winning turn.

A checkpoint refresh SHALL reset the new epoch's told-set without pre-marking unrendered entries; the next successful attempt accounts for actual baseline disclosure. Unrendered entries remain eligible under the ordinary append rules.

The told-set SHALL identify chats by their chat id. Storing an identifier for bookkeeping is not in tension with omitting identifiers from the rendered output: the two serve different purposes, and no stored id is ever rendered.

The worker SHALL recheck the owner setting and chat digest epoch under tenant scope immediately before preparing the final request and system-only receipt, after candidate resolution. If sharing was disabled during resolution, discard the new baseline/append candidate and proceed without newly produced digest content. This check SHALL occur before target-model I/O, not after disclosure. A checkpoint's re-resolved baseline commits in the checkpoint's own fenced transaction, which precedes the final request, so for that candidate the recheck SHALL run inside that transaction, after candidate resolution and before the refreshed baseline is written; a withdrawal before that point discards the candidate and the checkpoint publishes without the digest refresh. Existing baseline retention on withdrawal remains unchanged.

Baseline/told-set initialization and append advancement SHALL be staged for the attempt and committed atomically with its successful turn and persisted context text. A checkpoint SHALL publish its refreshed baseline and reset told-set in its own fenced atomic transaction under `model-system-prompts`, before the model step it precedes. Failed, cancelled, or superseded attempts SHALL leave the committed digest state unchanged, except that a checkpoint already published with its refreshed baseline survives the failure of the attempt it preceded, because the checkpoint and its epoch state describe committed history only and a retry reuses them rather than re-resolving. At most one baseline epoch SHALL exist per chat; existing single-flight and attempt/epoch fencing SHALL prevent competing initialization or a stale compaction candidate from overwriting current state.

A setting change after request preparation applies to later attempts; it cannot undo content already sent. Successful publication SHALL record the actual prepared disclosure rather than pretending a later withdrawal prevented it. Receipts and committed content retain the existing non-erasure contract.

Detecting events SHALL NOT require re-reading the chat's persisted message parts to reconstruct what was already announced; the told-set is the record. The told-set SHALL be advanced **in the same transaction as the append it accounts for**, so a run that fails to persist cannot leave the conversation marked as having been told something it never received.

#### Scenario: Baseline stays fixed while the told-set grows

- **WHEN** several appends are emitted over a chat's life
- **THEN** the rendered baseline is byte-identical throughout
- **AND** the told-set contains the baseline's chats plus every appended chat

#### Scenario: Re-resolution resets both

- **WHEN** the baseline is re-resolved at a checkpoint
- **THEN** the new epoch replaces the old told-set and records only actual successful disclosure of the fresh baseline
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

- **WHEN** an owner disables `shareRecentChats` after the worker has resolved a baseline candidate but before its final pre-request owner-setting check
- **THEN** the candidate is discarded and no new baseline or append is sent or committed
- **AND** the run proceeds without digest content rather than failing

#### Scenario: A failed attempt leaves no baseline

- **WHEN** an initializing attempt resolves a baseline but does not successfully complete
- **THEN** no baseline or told-set state persists for that chat
- **AND** a permitted retry or later Run resolves the baseline afresh

#### Scenario: A failed run does not advance the told-set

- **WHEN** an append is prepared but its attempt fails before successful publication
- **THEN** the told-set is unchanged
- **AND** the same event is detected again on the next run

#### Scenario: A tool description is the only baseline disclosure

- **WHEN** the successful attempt's system template omits the digest but an admitted tool description renders it
- **THEN** the told-set accounts for the baseline entries actually disclosed through that description
- **AND** the tool description itself is not persisted in a receipt

#### Scenario: Sharing is withdrawn after the prepared request

- **WHEN** sharing is disabled after the attempt's pre-request check and that attempt succeeds
- **THEN** successful publication records the digest actually sent under the checked setting
- **AND** later attempts obey withdrawal without rewriting existing receipts or committed content

### Requirement: Committed digest baselines remain stable until compaction

The digest SHALL be resolved for an initializing execution attempt with `shareRecentChats` enabled and stored as an immutable per-chat baseline only on its successful turn, and every subsequent run for that chat SHALL render that stored baseline rather than re-querying the owner's chats. Rendering the same baseline SHALL be deterministic, so **the digest contributes no per-turn variation to the prompt**: across runs whose other effective-context inputs are unchanged, the resulting system prompt is byte-identical and the prompt text/hash is unchanged, although each attempt has its own receipt. An owner fork that copied a baseline from its source SHALL continue that baseline rather than resolve a new one on its first Run.

The stability claim is scoped to the digest, not the whole prompt. Current personalization and admitted membership resolve per attempt, selected model templates may differ, and worker restart may load changed files. Each prepared attempt has its own system-only receipt even when its rendered text/hash matches another attempt's. Failed initializing attempts publish no baseline, so their retries may resolve a fresh candidate.

The baseline SHALL be re-resolved **only when that chat publishes a checkpoint**. A model switch SHALL NOT re-resolve it: the stored baseline SHALL be re-rendered through the new model's template, so the prompt text changes while the listed chats do not. The rationale SHALL be documented — compaction is a context boundary at which the conversation is rewritten anyway, whereas a model switch changes only which provider reads an unchanged conversation, and refreshing the chat list there would silently change what the assistant knows about the owner as a side effect of an unrelated action.

Re-resolution SHALL apply every eligibility, cap, ordering, and disjointness rule afresh, and SHALL overwrite the stored baseline. Earlier attempts SHALL retain their immutable system-only receipts. Runtime-only tool descriptions cannot be recovered from those receipts.

#### Scenario: Second turn in a chat reuses the baseline

- **WHEN** a second attempt executes in a chat with a committed baseline and every other rendered system-prompt input is unchanged
- **THEN** its rendered system prompt is byte-identical to the earlier attempt's
- **AND** its distinct attempt receipt carries the same system-prompt text/hash

#### Scenario: A changed non-digest input has a fresh receipt

- **WHEN** owner inputs, the selected model template, or admitted membership changes between attempts
- **THEN** the worker renders from those current inputs and creates that attempt's system-only receipt
- **AND** the digest uses the same stored baseline until compaction

#### Scenario: Compaction refreshes the listed chats

- **WHEN** a chat publishes a checkpoint and its owner's eligible chats have changed since the chat was created
- **THEN** the baseline is re-resolved against the owner's current chats
- **AND** the request that follows that publication, and later runs in that chat, render the refreshed list

#### Scenario: Model switch preserves the listed chats

- **WHEN** an owner switches models mid-chat
- **THEN** the digest lists exactly the chats it listed before the switch
- **AND** the new model's prompt text differs only because its template differs

#### Scenario: An earlier run's receipt is not rewritten

- **WHEN** a baseline is re-resolved at compaction
- **THEN** earlier system-only receipts still disclose any digest their system prompt actually carried
- **AND** no earlier receipt is mutated to claim content it did not send

#### Scenario: Owner continues a fork

- **WHEN** the fork's first Run follows a baseline copied from the source Chat
- **THEN** it renders that baseline without initializing a new one
- **AND** later appends and compaction in the fork evolve its own copy only

### Requirement: Changes after the baseline are appended as events, never as a restated list

Between baselines, changes SHALL reach the model as appended server-authored context items on the rail the `context-injection` capability defines, ordered as that capability specifies. The envelope, the per-item provenance framing, and the placement rule are owned by that capability and SHALL NOT be restated here. An append SHALL describe **what happened**, not the current state of either list, and SHALL never restate the digest.

There SHALL be exactly **one** event: a chat **entered the told-set**, or **its pin state changed** relative to what the told-set records. Events SHALL be derived by comparison against stored state and SHALL NOT be derived from timestamps.

The two halves of that comparison SHALL read **different candidate sets**, and conflating them breaks the digest in opposite directions:

- **New entries** SHALL be drawn only from the **capped views** — the same top-10 pinned and top-10 recent selection the baseline uses, resolved afresh — minus the told-set. Comparing against the owner's whole _eligible_ corpus instead would append every untold titled chat on the next run: an owner with 500 chats would receive hundreds of appends and have their entire corpus disclosed, defeating the cap the digest exists to enforce.
- **Pin-state changes** SHALL be checked over the **already-told chat ids only**, against `pins` membership, and SHALL NOT be restricted to the capped views. Restricting them would miss an unpin of a told chat that has since fallen outside the top 10, leaving the model permanently wrong about it.

So: capped views bound what may be _added_; the told-set bounds what may be _corrected_. This is required rather than preferred: no stored column records when a chat gained a title, and unpinning is a hard row deletion that leaves no trace, so a timestamp-based derivation cannot see two of the three transitions it would need.

The comparison SHALL be **asymmetric**. A chat present in the current eligible view and absent from the told-set SHALL produce an append. A chat whose current pin state differs from its told pin state SHALL produce an append, in both directions. A chat that has **left** the eligible view SHALL produce nothing. Archival, deletion, and displacement by newer chats therefore need no rule of their own: each is simply a departure, and departures are ignored.

**Pin state SHALL mean membership in the owner's pins, never membership in the rendered pinned list.** The two diverge whenever a newly pinned chat pushes another out of the capped rendering: the displaced chat is still pinned, and reporting it as unpinned would be false. An unpin append SHALL therefore fire only when the owner actually removed the pin. Deriving pin state from the rendered list instead would turn every cap displacement into a fabricated unpin.

The told-set SHALL record only chats the model was actually told about. Resolving the lists requires reading the owner's complete pin set, since a capped, ordered selection cannot be computed from a partial one — but that full set is **selection input, not told state**. Recording pin state for a chat the model was never told about would let unpinning it emit an append that introduces the chat solely in order to demote it, which discloses more than saying nothing. Such a chat instead enters through the ordinary path if and when it becomes eligible.

Gaining a title SHALL NOT be specified as the event. It is the most common _reason_ a chat becomes eligible, not the transition itself — a chat that was below the cap and re-enters the view because the owner returned to it has gained nothing, and SHALL produce an append on the same footing as a newly titled one.

An append SHALL carry the same per-entry shape as a baseline entry, including the capped excerpt, so that an appended chat and a baseline chat are equally usable. Multiple events occurring between two runs SHALL be batched into a single append.

When the baseline is re-resolved at a checkpoint, a single **supersession marker** SHALL be appended stating that the list has been refreshed and that earlier chat-list updates are superseded. That marker SHALL ride the request prepared after the checkpoint publication, since the checkpoint itself absorbs the earlier appends. It SHALL be expressed through the rail's `snapshot` form, whose defined meaning is that a later snapshot from the same producer supersedes an earlier one, rather than through a marker shape private to this capability. No supersession marker SHALL be emitted on a model switch, because nothing is superseded. When a delta and an effective-context change fall on the same turn, both items SHALL be emitted independently with no combined or special-cased form.

Appends SHALL be persisted with the message they accompany and SHALL NOT be rewritten or retracted.

No ceiling SHALL be imposed on how many appends accumulate between re-resolutions. Accumulation is driven by how often the owner starts or returns to other chats, while re-resolution is driven by the current chat's length — **uncorrelated axes**, so a long-lived, low-volume conversation may accumulate appends indefinitely without ever re-baking. This is accepted rather than capped: a cap would silently withhold chats the owner is actively working in, and the alternative reset trigger — re-resolving on size — would change the prompt mid-chat and forfeit the cache for the whole accumulated history, which is the cost the frozen baseline exists to avoid. The consequence SHALL be documented, and a future adaptive-append policy MAY revisit it.

#### Scenario: A new chat becomes eligible mid-conversation

- **WHEN** the owner creates another chat and its title is generated while the current chat is ongoing
- **THEN** the next run in the current chat carries an append naming that chat with its title, date, message count, and capped excerpt
- **AND** the system prompt is unchanged

#### Scenario: An old chat resurfaces

- **WHEN** a chat that was below the cap at baseline time receives a new message and re-enters the eligible view
- **THEN** an append is emitted for it on the same footing as a newly titled chat
- **AND** it is not silently skipped for having gained no title

#### Scenario: An already-told chat does not repeat

- **WHEN** a chat announced by an earlier append remains eligible on every subsequent run
- **THEN** no further append names it
- **AND** the comparison is made against the told-set rather than the rendered baseline

#### Scenario: Displacement produces nothing

- **WHEN** enough new chats become eligible that a chat listed in the baseline would no longer fall within the recency cap
- **THEN** no append is emitted about the displaced chat
- **AND** the baseline continues to list it

#### Scenario: A newly pinned chat displaces another from the rendered list

- **WHEN** the owner pins a chat and that pushes a previously rendered pinned chat past the cap
- **THEN** an append is emitted for the newly pinned chat
- **AND** no append claims the displaced chat was unpinned, because it is still pinned

#### Scenario: An untold pinned chat is unpinned

- **WHEN** the owner unpins a pinned chat that was beyond the cap and never announced
- **THEN** no append is emitted, because the told-set holds no pin state for it
- **AND** it may later enter through the ordinary eligibility path

#### Scenario: Owner unpins a chat

- **WHEN** the owner unpins a chat the told-set records as pinned
- **THEN** the next run carries an append recording that the chat is no longer pinned
- **AND** neither the baseline nor any earlier append is modified

#### Scenario: Owner deletes a chat

- **WHEN** the owner deletes a chat that the digest listed
- **THEN** no append is emitted about the deletion, because a departure from the eligible view produces nothing
- **AND** the chat stops appearing in baselines resolved after that point

#### Scenario: A delta and a model switch coincide

- **WHEN** a run is enqueued that both switches models and carries a pending digest event
- **THEN** the effective-context-change item and the digest append are both emitted
- **AND** neither is suppressed, merged, or reordered relative to the order the `context-injection` capability specifies

#### Scenario: Compaction emits a supersession marker

- **WHEN** a checkpoint re-resolves the baseline and its absorbed boundary supersedes the earlier appends
- **THEN** a single supersession marker is appended in the request prepared after that publication, stating that earlier chat-list updates are superseded
- **AND** the refreshed list is not restated on the message rail
