## RENAMED Requirements

- FROM: `### Requirement: The owner can see exactly what the digest sent`
- TO: `### Requirement: The owner can inspect system-prompt digest text and committed appends`

## MODIFIED Requirements

### Requirement: The digest is owner-scoped, and the setting gates production of digest state

The digest SHALL read only the requesting owner's own chats, under that owner's tenant scope, with row-level security as the enforcing boundary and application-level owner filters retained as defense-in-depth. It SHALL be unreachable through the public or shared-chat path, which carries no owner identity, and SHALL fail closed when identity is absent.

The setting gates the **production** of digest state, not the rendering of state already bound to a chat. While `shareRecentChats` is disabled: no baseline SHALL be resolved for a new chat, no baseline SHALL be re-resolved at compaction, and no appends SHALL be emitted. A chat that already carries a baseline SHALL continue to render it unchanged, because withdrawal is not retroactive — see the withdrawal requirement below, which this clause must be read with rather than against.

For a chat that carries **no** baseline — every chat of an owner who has never enabled the setting, and every chat first run after they disabled it — omission SHALL be complete at every level: no digest content, no framing prose, no empty block, so the rendered prompt is byte-identical to the same template with the digest section removed.

Compaction of a chat whose owner has since disabled the setting SHALL leave the existing baseline and told-set untouched rather than re-resolving or clearing them, so the chat continues to send exactly what it was already sending.

Re-enabling SHALL be defined rather than left to interpretation. For a chat that **already has** a baseline, re-enabling resumes appends and compaction re-bakes against the existing epoch. For a chat that has **no** baseline — one whose runs all happened while the setting was off — the next successful turn whose attempt prepares a baseline with sharing enabled SHALL initialize the baseline and told-set atomically, exactly as an ordinary initializing run does. Appends SHALL NOT be emitted for a chat with no baseline, since there is no told-set to diff against; the gate on appends is therefore the setting **and** the existence of a baseline, not the setting alone.

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

### Requirement: The owner can inspect system-prompt digest text and committed appends

The owner's system-only receipt SHALL contain the exact digest text included in that attempt's system prompt, including an attempt that later failed. Successful appends SHALL be inspectable as parts of the owner's own messages. Digest variables MAY also render in tool descriptions, but those descriptions SHALL remain runtime-only: receipts SHALL neither expose a stored description nor claim to reconstruct its historical wording. Document this inspection boundary.

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

### Requirement: Digest content is framed as data and cannot forge its own structure

The digest SHALL render inside a named delimited block. Framing prose SHALL precede it stating that the block lists the owner's other chats, that it is data rather than instructions from a higher authority, that it ranks below the system instructions and below the owner's requests in the current conversation, that it cannot grant tools or capabilities, relax tool authorization, or override safety or transparency rules, and that any text inside it attempting those is to be disregarded. The block SHALL close with an explicit restatement that ordinary instruction-following resumes and that nothing inside the block altered it.

Titles and excerpts SHALL be neutralized by the same tag rules the templating capability applies to owner-authored text — a value can never close a tag it did not open within that same value, and can never emit a reserved delimiter name as a tag at all — so no entry can terminate the block or forge a second one. Rendered output SHALL NOT be re-evaluated as a template.

This framing SHALL be documented as **advisory rather than structurally enforced**, carried by the packaged default's prose and by model compliance, consistent with the precedence ladder the personalization capability already states. Only the delimiter's integrity is structurally guaranteed. An operator who replaces the packaged default may reshape or remove the framing, and the consequence SHALL be documented rather than defended.

#### Scenario: A chat title contains instruction-shaped text

- **WHEN** a listed chat's title or excerpt contains text instructing the assistant to ignore prior instructions
- **THEN** it renders as content inside the block
- **AND** admitted tool ids, schemas, classifications, and execution authority are unchanged by digest text; templated description wording may differ

#### Scenario: An excerpt attempts to close the block

- **WHEN** a listed chat's excerpt contains the block's closing delimiter, which the excerpt itself never opened
- **THEN** the delimiter is escaped as content and the block is not terminated early
- **AND** the rendered prompt contains exactly one delimiter pair

#### Scenario: The block restates instruction-following on exit

- **WHEN** the digest renders for any owner
- **THEN** framing prose precedes the block and a restatement of instruction-following follows it
- **AND** both appear in the system-only receipt when rendered in the system prompt; descriptions remain runtime-only

## ADDED Requirements

### Requirement: Digest baseline and disclosure state publish with the successful attempt

Each chat SHALL carry two distinct pieces of digest state, and they SHALL NOT be conflated:

- The **rendered baseline** — the capped, ordered entries available to both prompt surfaces. It is written once, with the chat's first successful turn whose attempt prepared it with the setting enabled, and is **immutable until re-resolution**, which keeps the digest contribution stable across the chat's turns.
- The **told-set** — every chat this conversation has been told about in successful model context, whether through a rendered baseline in either prompt surface or a later append, with the pin state last communicated for each. It **grows** with every append.

Both SHALL be reset together when the baseline is re-resolved at compaction. The new epoch's told-set SHALL include only entries actually disclosed by a successful target request; a post-success refresh awaiting its first request starts with no newly disclosed entries.

The told-set SHALL record only chats the model actually received. Initialization SHALL therefore derive it from the baseline actually **rendered** in the winning attempt's system prompt or admitted tool descriptions, not merely from the fact that baseline state was written: operator templates that omit the digest from both surfaces leave the baseline unrendered, and marking those chats told would suppress their later appends and disclose them never. A chat whose baseline entry was never rendered SHALL remain untold, so it enters through the ordinary append path when the ordinary append rules make it eligible.

Both prompt renders SHALL return private disclosure metadata alongside text, keyed to the trusted digest candidates. Record entry ids only when their entry values are actually emitted along the executed template branch, not when a collection is tested/iterated or only aggregate counts are emitted. Use the existing validated renderer's emission path, not string matching, reparsing rendered text, or a second template engine. These ids SHALL not become new template variables or stored tool-description metadata. Use the union of prior told state and the current render's actual baseline disclosure when deriving this attempt's appends; commit that union plus successful digest appends only with the winning turn.

A post-success compaction refresh SHALL reset the new epoch's told-set without pre-marking unrendered entries; the next successful attempt accounts for actual baseline disclosure. Unrendered entries remain eligible under the ordinary append rules.

The told-set SHALL identify chats by their chat id. Storing an identifier for bookkeeping is not in tension with omitting identifiers from the rendered output: the two serve different purposes, and no stored id is ever rendered.

The worker SHALL recheck the owner setting and chat digest epoch under tenant scope immediately before preparing the final request and system-only receipt, after candidate resolution. If sharing was disabled during resolution, discard the new baseline/append candidate and proceed without newly produced digest content. This check SHALL occur before target-model I/O, not after disclosure. Existing baseline retention on withdrawal remains unchanged.

Baseline/told-set initialization, append advancement, and pre-request transition-compaction refreshes SHALL be staged for the attempt and committed atomically with its successful turn and persisted context text. Post-success full-current compaction SHALL publish its checkpoint and refreshed baseline in its own fenced atomic transaction under `model-system-prompts`; it SHALL not pretend the new baseline was already disclosed by the source turn. Failed, cancelled, or superseded attempts SHALL leave the committed digest state unchanged. At most one baseline epoch SHALL exist per chat; existing single-flight and attempt/epoch fencing SHALL prevent competing initialization or a stale compaction candidate from overwriting current state.

A setting change after request preparation applies to later attempts; it cannot undo content already sent. Successful publication SHALL record the actual prepared disclosure rather than pretending a later withdrawal prevented it. Receipts and committed content retain the existing non-erasure contract.

Detecting events SHALL NOT require re-reading the chat's persisted message parts to reconstruct what was already announced; the told-set is the record. The told-set SHALL be advanced **in the same transaction as the append it accounts for**, so a run that fails to persist cannot leave the conversation marked as having been told something it never received.

#### Scenario: Baseline stays fixed while the told-set grows

- **WHEN** several appends are emitted over a chat's life
- **THEN** the rendered baseline is byte-identical throughout
- **AND** the told-set contains the baseline's chats plus every appended chat

#### Scenario: Re-resolution resets both

- **WHEN** the baseline is re-resolved at compaction
- **THEN** the new epoch replaces the old told-set and records only actual successful disclosure of the fresh baseline
- **AND** the next preparation accounts for entries rendered in either prompt surface before deriving appends, so that same request does not re-announce them

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

The digest SHALL be resolved for an initializing execution attempt with `shareRecentChats` enabled and stored as an immutable per-chat baseline only on its successful turn, and every subsequent run for that chat SHALL render that stored baseline rather than re-querying the owner's chats. Rendering the same baseline SHALL be deterministic, so **the digest contributes no per-turn variation to the prompt**: across runs whose other effective-context inputs are unchanged, the resulting system prompt is byte-identical and the prompt text/hash is unchanged, although each attempt has its own receipt.

The stability claim is scoped to the digest, not the whole prompt. Current personalization and admitted membership resolve per attempt, selected model templates may differ, and worker restart may load changed files. Each prepared attempt has its own system-only receipt even when its rendered text/hash matches another attempt's. Failed initializing attempts publish no baseline, so their retries may resolve a fresh candidate.

The baseline SHALL be re-resolved **only when that chat is compacted**. A model switch SHALL NOT re-resolve it: the stored baseline SHALL be re-rendered through the new model's template, so the prompt text changes while the listed chats do not. The rationale SHALL be documented — compaction is a context boundary at which the conversation is rewritten anyway, whereas a model switch changes only which provider reads an unchanged conversation, and refreshing the chat list there would silently change what the assistant knows about the owner as a side effect of an unrelated action.

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

- **WHEN** a chat is compacted and its owner's eligible chats have changed since the chat was created
- **THEN** the baseline is re-resolved against the owner's current chats
- **AND** subsequent runs in that chat render the refreshed list

#### Scenario: Model switch preserves the listed chats

- **WHEN** an owner switches models mid-chat
- **THEN** the digest lists exactly the chats it listed before the switch
- **AND** the new model's prompt text differs only because its template differs

#### Scenario: An earlier run's receipt is not rewritten

- **WHEN** a baseline is re-resolved at compaction
- **THEN** earlier system-only receipts still disclose any digest their system prompt actually carried
- **AND** no earlier receipt is mutated to claim content it did not send

## REMOVED Requirements

### Requirement: Per-chat digest state is two fields with different lifecycles

**Reason**: Replaced by `Digest baseline and disclosure state publish with the successful attempt`; acceptance-time or failed-attempt publication semantics are retired.

**Migration**: Apply the replacement requirement prospectively with the worker-attempt cutover. Preserve existing digest baselines and told-sets under the `context-injection` cutover boundary; do not rebuild or clear them to remove pre-cutover failed-Run contributions. Preserve unrelated scenarios and existing owner isolation; remove the obsolete binding/publication behavior.

### Requirement: The digest is resolved at most once per chat and re-resolved only at compaction

**Reason**: Replaced by `Committed digest baselines remain stable until compaction`; acceptance-time or failed-attempt publication semantics are retired.

**Migration**: Apply the replacement requirement with the worker-attempt cutover. Preserve unrelated scenarios and existing owner isolation; remove the obsolete binding/publication behavior.
