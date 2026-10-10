## MODIFIED Requirements

### Requirement: Digest baseline and disclosure state commit before dispatch

Each chat SHALL carry two distinct pieces of digest state, and they SHALL NOT be conflated:

- The **rendered baseline** — the capped, ordered entries available to both prompt surfaces. It is written once, in the dispatch transaction of the chat's first attempt that prepared it with the setting enabled, and is **immutable until re-resolution**, which keeps the digest contribution stable across the chat's turns.
- The **told-set** — every chat this conversation has been told about in dispatched model context, whether through a rendered baseline in either prompt surface or a later append, with the pin state last communicated for each. It **grows** with every append.

Both SHALL be reset together when the baseline is re-resolved at a checkpoint. The refresh SHALL be published with that checkpoint, in the same transaction, before the model step the checkpoint precedes; it SHALL not pretend the refreshed baseline was already disclosed by that step. The new epoch's told-set SHALL include only entries actually disclosed by a dispatched request, so a refresh awaiting its first request starts with no newly disclosed entries.

The told-set SHALL record only chats the model actually received. Initialization SHALL therefore derive it from the baseline actually **rendered** in the dispatching attempt's system prompt or admitted tool descriptions, not merely from the fact that baseline state was written: operator templates that omit the digest from both surfaces leave the baseline unrendered, and marking those chats told would suppress their later appends and disclose them never. A chat whose baseline entry was never rendered SHALL remain untold, so it enters through the ordinary append path when the ordinary append rules make it eligible.

Both prompt renders SHALL return private disclosure metadata alongside text, keyed to the trusted digest candidates. Record entry ids only when their entry values are actually emitted along the executed template branch, not when a collection is tested/iterated or only aggregate counts are emitted. Use the existing validated renderer's emission path, not string matching, reparsing rendered text, or a second template engine. These ids SHALL not become new template variables or stored tool-description metadata. Use the union of prior told state and the current render's actual baseline disclosure when deriving this attempt's appends; commit that union plus this attempt's digest appends in its dispatch transaction.

A checkpoint refresh SHALL reset the new epoch's told-set without pre-marking unrendered entries; the next dispatching attempt accounts for actual baseline disclosure. Unrendered entries remain eligible under the ordinary append rules.

The told-set SHALL identify chats by their chat id. Storing an identifier for bookkeeping is not in tension with omitting identifiers from the rendered output: the two serve different purposes, and no stored id is ever rendered.

The worker SHALL recheck the owner setting and chat digest epoch under tenant scope immediately before preparing the final request and system-only receipt, after candidate resolution. If sharing was disabled during resolution, discard the new baseline/append candidate and proceed without newly produced digest content. This check SHALL occur before target-model I/O, not after disclosure. A checkpoint's re-resolved baseline commits in the checkpoint's own fenced transaction, which precedes the final request, so for that candidate the recheck SHALL run inside that transaction, after candidate resolution and before the refreshed baseline is written; a withdrawal before that point discards the candidate and the checkpoint publishes without the digest refresh. Existing baseline retention on withdrawal remains unchanged.

Baseline/told-set initialization and append advancement SHALL be staged for the attempt and committed atomically with its persisted context text in the attempt's dispatch transaction that `context-injection` defines, before the request that carries them. A checkpoint SHALL publish its refreshed baseline and reset told-set in its own fenced atomic transaction under `model-system-prompts`, before the model step it precedes. A superseded attempt, or an attempt that fails before its dispatch transaction, SHALL leave the committed digest state unchanged. A later failure, cancellation, or expiry of the Run SHALL NOT retract what that transaction committed, and a retried attempt of the Run, whose `dispatched_at` is then set, SHALL reuse it rather than resolve or append again. A checkpoint already published with its refreshed baseline likewise survives the failure of the attempt it preceded, because the checkpoint and its epoch state describe committed history only and a retry reuses them rather than re-resolving. At most one baseline epoch SHALL exist per chat; existing single-flight and attempt/epoch fencing SHALL prevent competing initialization or a stale compaction candidate from overwriting current state.

A setting change after request preparation applies to later attempts; it cannot undo content already sent. The dispatch transaction SHALL record the actual prepared disclosure rather than pretending a later withdrawal prevented it. Receipts and committed content retain the existing non-erasure contract.

Detecting events SHALL NOT require re-reading the chat's persisted message parts to reconstruct what was already announced; the told-set is the record. The told-set SHALL be advanced **in the same transaction as the append it accounts for**, so a run that fails to persist cannot leave the conversation marked as having been told something it never received.

#### Scenario: Baseline stays fixed while the told-set grows

- **WHEN** several appends are emitted over a chat's life
- **THEN** the rendered baseline is byte-identical throughout
- **AND** the told-set contains the baseline's chats plus every appended chat

#### Scenario: Re-resolution resets both

- **WHEN** the baseline is re-resolved at a checkpoint
- **THEN** the new epoch replaces the old told-set and records only actual dispatched disclosure of the fresh baseline
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
- **THEN** the next attempt prepared with sharing enabled initializes the baseline and told-set atomically in its dispatch transaction
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

- **WHEN** an initializing attempt resolves a baseline but fails before its dispatch transaction commits
- **THEN** no baseline or told-set state persists for that chat
- **AND** a permitted retry or later Run resolves the baseline afresh

#### Scenario: A failed run does not advance the told-set

- **WHEN** an append is prepared but its attempt fails before its dispatch transaction commits
- **THEN** the told-set is unchanged
- **AND** the same event is detected again on the next run

#### Scenario: A failed run keeps its advanced told-set

- **WHEN** an append commits in its attempt's dispatch transaction and the Run then fails
- **THEN** the told-set includes the appended chat
- **AND** the same event is not announced again on the next run

#### Scenario: A retried attempt reuses the committed digest state

- **WHEN** an initializing attempt commits its dispatch transaction and the Run is then retried
- **THEN** the retry renders the persisted baseline and sends the persisted appends
- **AND** no second baseline or told-set update is written

#### Scenario: A tool description is the only baseline disclosure

- **WHEN** the dispatching attempt's system template omits the digest but an admitted tool description renders it
- **THEN** the told-set accounts for the baseline entries actually disclosed through that description
- **AND** the tool description itself is not persisted in a receipt

#### Scenario: Sharing is withdrawn after the prepared request

- **WHEN** sharing is disabled after the attempt's pre-request check and before its dispatch transaction commits
- **THEN** the dispatch transaction records the digest actually sent under the checked setting
- **AND** later attempts obey withdrawal without rewriting existing receipts or committed content

### Requirement: Committed digest baselines remain stable until compaction

The digest SHALL be resolved for an initializing execution attempt with `shareRecentChats` enabled and stored as an immutable per-chat baseline in its dispatch transaction, and every subsequent run for that chat SHALL render that stored baseline rather than re-querying the owner's chats. Rendering the same baseline SHALL be deterministic, so **the digest contributes no per-turn variation to the prompt**: across runs whose other effective-context inputs are unchanged, the resulting system prompt is byte-identical and the prompt text/hash is unchanged, although each attempt has its own receipt. An owner fork that copied a baseline from its source SHALL continue that baseline rather than resolve a new one on its first Run.

The stability claim is scoped to the digest, not the whole prompt. Current personalization and admitted membership resolve per attempt, selected model templates may differ, and worker restart may load changed files. Each prepared attempt has its own system-only receipt even when its rendered text/hash matches another attempt's. An initializing attempt that fails before its dispatch transaction publishes no baseline, so its retry may resolve a fresh candidate; once that transaction commits, the baseline stands whatever the Run's outcome.

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

#### Scenario: A failed first Run keeps its baseline

- **WHEN** a chat's first Run commits an initial baseline and then fails after its first model request
- **THEN** the next Run renders that stored baseline
- **AND** it does not re-query the owner's chats

### Requirement: The owner can inspect system-prompt digest text and committed appends

The owner's system-only receipt SHALL contain the exact digest text included in that attempt's system prompt, including an attempt that later failed. Committed appends, including those of a Run that later failed, SHALL be inspectable as parts of the owner's own messages. Digest variables MAY also render in tool descriptions, but those descriptions SHALL remain runtime-only: receipts SHALL neither expose a stored description nor claim to reconstruct its historical wording. Document this inspection boundary.

No digest content SHALL be exposed to any identity other than the owner, or written to operator logs or error messages. Resolution/render failures SHALL record safe failure kinds without titles or excerpts.

#### Scenario: Owner inspects a run's receipt

- **WHEN** an owner requests a system-only receipt whose system prompt carried the digest
- **THEN** it contains that rendered digest exactly as sent
- **AND** it exposes no host path, provider internal, or credential

#### Scenario: Digest appears only in a tool description

- **WHEN** a tool description rendered the digest but the system prompt did not
- **THEN** the receipt does not contain or reconstruct the tool description
- **AND** the documented receipt scope makes that limitation explicit

#### Scenario: Digest resolution fails

- **WHEN** resolving or rendering the digest fails
- **THEN** the log records the failure kind
- **AND** no chat title or excerpt appears in the log or in any error response

#### Scenario: Owner inspects a failed Run's append

- **WHEN** a Run commits a digest append and then fails
- **THEN** the append is visible as a part of the owner's user message
- **AND** no other identity can read it

### Requirement: The digest is owner-scoped, and the setting gates production of digest state

The digest SHALL read only the requesting owner's own chats, under that owner's tenant scope, with row-level security as the enforcing boundary and application-level owner filters retained as defense-in-depth. It SHALL be unreachable through the public or shared-chat path, which carries no owner identity, and SHALL fail closed when identity is absent.

The setting gates the **production** of digest state, not the rendering of state already bound to a chat. While `shareRecentChats` is disabled: no baseline SHALL be resolved for a new chat, no baseline SHALL be re-resolved at compaction, and no appends SHALL be emitted. A chat that already carries a baseline SHALL continue to render it unchanged, because withdrawal is not retroactive — see the withdrawal requirement below, which this clause must be read with rather than against.

For a chat that carries **no** baseline — every chat of an owner who has never enabled the setting, and every chat first run after they disabled it — omission SHALL be complete at every level: no digest content, no framing prose, no empty block, so the rendered prompt is byte-identical to the same template with the digest section removed.

Compaction of a chat whose owner has since disabled the setting SHALL leave the existing baseline and told-set untouched rather than re-resolving or clearing them, so the chat continues to send exactly what it was already sending.

Re-enabling SHALL be defined rather than left to interpretation. For a chat that **already has** a baseline, re-enabling resumes appends and compaction re-bakes against the existing epoch. For a chat that has **no** baseline — one whose runs all happened while the setting was off — the next attempt that prepares a baseline with sharing enabled SHALL initialize the baseline and told-set atomically in its dispatch transaction, exactly as an ordinary initializing run does. Appends SHALL NOT be emitted for a chat with no baseline, since there is no told-set to diff against; the gate on appends is therefore the setting **and** the existence of a baseline, not the setting alone.

Appends SHALL be gated by the setting together with the existence of a baseline, and by nothing else. The system SHALL NOT gate appends on whether either prompt surface rendered the digest; operator templates that omit the block from both surfaces while the setting is enabled SHALL still receive appends, and this consequence SHALL be documented rather than mitigated, consistent with the existing rule that a prompt referencing no per-user path silently forgoes that content.

#### Scenario: Setting is disabled and the chat has no baseline

- **WHEN** a chat's first run happens while its owner's `shareRecentChats` setting is off
- **THEN** no baseline is resolved, and no digest content, framing prose, or delimiter appears in the effective prompt
- **AND** no digest append is emitted on any turn of that chat

#### Scenario: Setting is disabled after a chat already carries a baseline

- **WHEN** an owner disables `shareRecentChats` while a chat that already carries a baseline remains open
- **THEN** that chat continues to render its bound baseline unchanged
- **AND** no further appends are emitted, and compaction neither re-resolves nor clears it

#### Scenario: Public read of a shared chat

- **WHEN** an unauthenticated caller views a chat whose visibility is public
- **THEN** no digest content is reachable through that path
- **AND** the owner's other chat titles and excerpts are not disclosed

#### Scenario: One owner's digest never contains another owner's chats

- **WHEN** the row-level-security suite resolves a digest with another user's identity set, and again with the empty identity
- **THEN** no other owner's chats are readable
- **AND** no title or excerpt is disclosed

#### Scenario: Operator template omits the block

- **WHEN** an owner with the setting enabled uses system and tool templates that reference no digest path
- **THEN** the run executes normally with no digest in the prompt
- **AND** appends are still emitted, and nothing reports the mismatch

#### Scenario: A re-enabled chat keeps the baseline of a failed Run

- **WHEN** an owner re-enables `shareRecentChats` for a chat with no baseline and that chat's next Run commits its dispatch transaction and then fails
- **THEN** the baseline and told-set stay initialized
- **AND** the following Run renders that baseline and may emit appends

## RENAMED Requirements

- FROM: `### Requirement: Digest baseline and disclosure state publish with the successful attempt`
- TO: `### Requirement: Digest baseline and disclosure state commit before dispatch`
