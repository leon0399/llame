# chat-recency-digest

## Purpose

A bounded, owner-scoped digest of the owner's pinned and recent chats — each carrying a title, last-activity date, message count, and a short excerpt of its first user message — resolved on a chat's first run, frozen into that chat's system prompt, and updated thereafter only by appended events. It gives the assistant enough awareness of what the owner has been working on to decide unprompted that a prior chat is worth retrieving, without re-rendering a conversation dump on every turn.

## Requirements

### Requirement: The digest carries four bounded fields per chat and no identifier

The digest SHALL contain, for each listed chat, at most four fields and no others: its **title**, its **last-activity date**, its **message count**, and an **excerpt** of that chat's first user message truncated to a documented maximum of **200 Unicode code points**, cut on a code-point boundary. The unit SHALL be code points rather than UTF-16 units or bytes, so the cap does not vary by script and cannot split a character. Only the excerpt is omissible, and only in the case named below; the other three SHALL always render. The excerpt SHALL be taken from the earliest stored user message by insertion order, independent of whether that chat has since been compacted, so an entry's content is immutable once resolved. Assistant replies, tool output, reasoning, and any message after the first SHALL NOT appear.

The digest SHALL NOT carry chat identifiers. No shipped tool accepts a chat id, so an identifier would be inert while costing roughly eighteen to twenty tokens per entry — several hundred tokens of unusable text frozen into every chat's prompt. Identifiers belong on transient, requested surfaces that are paid for only when called, not in a standing prompt. Adding one later is a template edit rather than a migration, so the omission SHALL be revisited when a tool consumes one.

The last-activity date SHALL be rendered as an **absolute calendar date** and SHALL be labelled as last activity, so it is not mistaken for the date of the excerpt it sits beside — the excerpt is the chat's opening message and the date is its most recent, and a long-running chat legitimately shows a wide gap between them. Relative expressions ("three days ago") SHALL NOT be used: a frozen baseline renders the same text indefinitely, so a relative date decays into a confident falsehood.

The message count SHALL be the count of stored messages at the moment the entry was resolved, and SHALL be understood as frozen alongside the rest of the entry rather than tracking the chat.

The 200-code-point cap SHALL be documented as an **injection and disclosure control rather than a token-budget control**: a first user message frequently contains bulk pasted material, and the cap exists to retain the owner's own leading prose while truncating that payload. Raising it for perceived answer quality is therefore a security decision, not a tuning decision. A chat whose first user message has no text content SHALL render with **no excerpt field at all** rather than an empty one, and SHALL still render its title. Omission rather than an empty value is required, not cosmetic: rendered values are `SafeString`s, and a `SafeString` wrapping `""` is still a truthy object, so an empty-valued excerpt would satisfy the template's own presence check and emit a bare label with nothing after it.

The digest SHALL list at most **10 pinned chats** and at most **10 recent chats**. Pinned chats beyond the cap SHALL be absent from **both** lists, since the recent list is drawn from chats that are not pinned. This is accepted rather than worked around: the stated pinned ratio tells the model that more pinned chats exist, and once owner-controlled pin ordering ships the cut becomes a decision the owner made rather than an arbitrary recency boundary. Until then the cut SHALL be documented as ordered by recency and therefore not owner-chosen. The two lists SHALL be **disjoint**: a chat that is both pinned and recent SHALL appear only under pinned, and the recent list SHALL backfill from the next-most-recent unpinned chats so that it carries a full 10 whenever the owner has that many. Pinned SHALL render before recent. Both lists SHALL be ordered by last activity, most recent first, matching the ordering the chat-listing API already applies.

The rendered digest SHALL state, for each list, **how many entries it shows out of how many exist** — the pinned list against the owner's total **eligible pinned** chats, and the recent list against the owner's total eligible **unpinned** chats. "Eligible" carries the same meaning in both denominators as it does for list selection: the chat being rendered, archived chats, chats with no title or a whitespace-only title, and pins whose item is not a chat SHALL NOT be counted. A pinned chat that is excluded from the list for any of those reasons SHALL likewise be absent from `pinnedTotal`, so the ratio never claims a pinned chat the digest could not have shown. The recent list is drawn from eligible chats that are not pinned, so counting all eligible chats would describe a population the list is not selected from — with 30 pinned inside 247 eligible, the recent denominator is 217. Each denominator SHALL be the **exact** population its list is drawn from, so the two ratios describe the lists rather than approximating them. A capped read cannot yield an exact total, so the read path SHALL return the count independently of the capped rows — a cap that also truncates the denominator would report `10 of 10` for an owner with 247 chats, inverting the signal the ratio exists to give.

Bare prose that entries were omitted is insufficient. A ratio is what tells the model whether the digest is nearly complete or a thin slice of a deep corpus, which is precisely the judgment that should decide whether it retrieves: `10 of 12` and `10 of 247` warrant opposite behavior and identical prose. The counts SHALL be presented as a statement about the owner's corpus, not as usage statistics about the owner, and no derived behavioral measure — message frequency, session depth, activity streaks, model-usage breakdowns — SHALL be included.

The counts SHALL be resolved with the baseline and frozen alongside it; appends SHALL NOT update them. Their staleness is bounded by the same re-resolution boundary as every other entry and is covered by the stated compilation date.

The rendered digest SHALL NOT name a retrieval tool that is not advertised for that turn.

The rendered digest SHALL additionally state the **absolute date on which the list itself was compiled**, and that the list may be older than the current conversation. Without that anchor the per-entry dates are close to decorative: llame injects no current date anywhere, so a model reading `2026-07-20` cannot place it relative to now. A stated compilation date gives every entry a reference point and makes the list's frozen nature legible instead of hidden.

The framing SHALL further state that **every entry is a point-in-time record rather than an authoritative description of the chat as it stands now**, naming renaming specifically. That case has a functional consequence rather than a cosmetic one: retrieval matches titles live, so a title renamed after the list was compiled can match nothing, and the model needs to read a miss as staleness rather than as the chat not existing. The entry's excerpt is verbatim message content and remains reachable, so a content-derived query still recovers the chat.

#### Scenario: Digest lists a chat with a long first message

- **WHEN** an eligible chat's first user message exceeds the documented excerpt maximum
- **THEN** the rendered entry contains only the first 200 Unicode code points of that message
- **AND** no later message from that chat appears in the digest

#### Scenario: Digest contains no assistant or tool content

- **WHEN** the digest is rendered for an owner whose chats contain assistant replies, tool results, and reasoning
- **THEN** the rendered output contains none of that content
- **AND** only titles, last-activity dates, message counts, and first-user-message excerpts are present

#### Scenario: Digest carries no chat identifiers

- **WHEN** the digest is rendered for any owner
- **THEN** no chat identifier appears in the rendered output
- **AND** no entry offers the model a handle it could pass to a tool

#### Scenario: The list states when it was compiled and how far to trust it

- **WHEN** the digest is rendered
- **THEN** it states the absolute date the list was compiled, that it may be older than the current conversation, and that entries are point-in-time records whose titles may since have been renamed
- **AND** every entry's date is interpretable relative to that stated point

#### Scenario: A listed chat is renamed after the baseline is resolved

- **WHEN** the owner renames a chat that the baseline lists
- **THEN** the digest continues to show the title as it stood when the list was compiled
- **AND** no append corrects it, the framing having already stated that titles are not authoritative

#### Scenario: A long-running chat shows a recent date beside an old excerpt

- **WHEN** a listed chat was started weeks before its most recent activity
- **THEN** its date is labelled as last activity rather than presented as the excerpt's date
- **AND** the date is absolute rather than expressed relative to the present

#### Scenario: A pinned chat is also among the most recent

- **WHEN** an owner's most recently updated chat is also pinned
- **THEN** it appears once, under pinned, and not under recent
- **AND** the recent list backfills with the next-most-recent unpinned chat so it still carries 10 entries

#### Scenario: Digest states how much it is showing

- **WHEN** an owner with 247 eligible chats, 30 of them eligible and pinned, has a digest resolved
- **THEN** the rendered block states that it shows 10 of 30 pinned and 10 of 217 recent — the recent denominator excluding the 30 pinned, since the recent list is not drawn from them
- **AND** it carries no message-frequency, session-depth, streak, or model-usage measure

#### Scenario: Owner has fewer chats than the caps

- **WHEN** an owner has three eligible chats and none pinned
- **THEN** the pinned list is omitted entirely and the recent list contains those three
- **AND** no placeholder or padding entry is rendered

#### Scenario: A chat's first message carries no text

- **WHEN** an eligible chat's first user message contains only non-text parts
- **THEN** its entry renders its title, date, and message count with no excerpt
- **AND** the entry is not dropped from the digest

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

### Requirement: Per-chat digest state is two fields with different lifecycles

Each chat SHALL carry two distinct pieces of digest state, and they SHALL NOT be conflated:

- The **rendered baseline** — the capped, ordered entries that appear in the system prompt. It is written once, on the chat's first run with the setting enabled, and is **immutable until re-resolution**, which is what makes the prompt byte-identical across the chat's turns.
- The **told-set** — every chat this conversation has been told about, whether through the baseline or a later append, with the pin state last communicated for each. It **grows** with every append.

Both SHALL be reset together when the baseline is re-resolved at compaction, so a new epoch begins with the told-set matching exactly what the fresh baseline states.

The told-set SHALL record only chats the model actually received. Initialization SHALL therefore derive it from the **rendered** baseline bound to the run, not merely from the fact that baseline state was written: an operator template that omits the digest block leaves the baseline unrendered, and marking those chats told would suppress their later appends and disclose them never. A chat whose baseline entry was never rendered SHALL remain untold, so it enters through the ordinary append path if and when the template does render the digest.

The told-set SHALL identify chats by their chat id. Storing an identifier for bookkeeping is not in tension with omitting identifiers from the rendered output: the two serve different purposes, and no stored id is ever rendered.

The setting value that governs production SHALL be the one observed **inside the binding transaction**, not the one read while resolving the candidate. Resolution happens before that transaction opens, so an owner who disables sharing in between would otherwise have a baseline or append committed under a setting that was already false. A candidate resolved under a setting value that no longer holds at commit SHALL be discarded rather than bound.

Baseline and told-set initialization SHALL commit **atomically with the accepted Run's binding** — the same transaction that persists the user message, the Run, and its effective-context snapshot. A request that fails to bind, or that loses a concurrent race, SHALL leave no baseline behind. **At most one** baseline epoch SHALL exist per chat at any time; a chat that has never had an initializing run has none, which is a valid state rather than a violated invariant. Two concurrent initializing sends SHALL NOT produce divergent baselines or divergent first snapshots: the loser SHALL abort or retry against the winner's baseline rather than bind a snapshot rendered from its own pre-resolved candidate.

Detecting events SHALL NOT require re-reading the chat's persisted message parts to reconstruct what was already announced; the told-set is the record. The told-set SHALL be advanced **in the same transaction as the append it accounts for**, so a run that fails to persist cannot leave the conversation marked as having been told something it never received.

#### Scenario: Baseline stays fixed while the told-set grows

- **WHEN** several appends are emitted over a chat's life
- **THEN** the rendered baseline is byte-identical throughout
- **AND** the told-set contains the baseline's chats plus every appended chat

#### Scenario: Re-resolution resets both

- **WHEN** the baseline is re-resolved at compaction
- **THEN** the told-set is reset to exactly the chats the fresh baseline states
- **AND** a chat announced before the re-bake that is still eligible is not re-announced immediately afterwards

#### Scenario: Concurrent initializing sends produce one baseline

- **WHEN** two initializing sends for the same chat race, both with the setting enabled
- **THEN** exactly one baseline epoch exists afterwards
- **AND** the losing request aborts or retries against the winner's baseline rather than binding a snapshot rendered from its own candidate

#### Scenario: Owner re-enables the setting for a chat that has no baseline

- **WHEN** an owner turns `shareRecentChats` back on for an ongoing chat whose runs all happened while it was off
- **THEN** the next accepted Run initializes the baseline and told-set atomically
- **AND** no append is emitted before that baseline exists

#### Scenario: The setting is disabled between resolution and commit

- **WHEN** an owner disables `shareRecentChats` after a request has resolved a baseline candidate but before that request's binding transaction commits
- **THEN** the candidate is discarded and no baseline or append is bound
- **AND** the run proceeds without digest content rather than failing

#### Scenario: A failed bind leaves no baseline

- **WHEN** a first send resolves a baseline but its binding transaction does not commit
- **THEN** no baseline or told-set state persists for that chat
- **AND** the next send resolves the baseline afresh

#### Scenario: A failed run does not advance the told-set

- **WHEN** an append is authored but its transaction does not commit
- **THEN** the told-set is unchanged
- **AND** the same event is detected again on the next run

### Requirement: The digest is resolved at most once per chat and re-resolved only at compaction

The digest SHALL be resolved on a chat's **first run for which `shareRecentChats` is enabled** and stored as an immutable per-chat baseline, and every subsequent run for that chat SHALL render that stored baseline rather than re-querying the owner's chats. Rendering the same baseline SHALL be deterministic, so **the digest contributes no per-turn variation to the prompt**: across runs whose other effective-context inputs are unchanged, the resulting system prompt is byte-identical and the snapshot is reused rather than re-minted.

The stability claim is scoped to the digest and SHALL NOT be read as a guarantee over the whole prompt. Personalization resolves per run, the selected model supplies the template, the operator may reload a prompt file, and the tool-availability manifest is part of the snapshot's identity — so any of those changing legitimately mints a new snapshot, exactly as `model-system-prompts` requires. What this requirement forbids is the digest itself being the thing that changes.

The baseline SHALL be re-resolved **only when that chat is compacted**. A model switch SHALL NOT re-resolve it: the stored baseline SHALL be re-rendered through the new model's template, so the prompt text changes while the listed chats do not. The rationale SHALL be documented — compaction is a context boundary at which the conversation is rewritten anyway, whereas a model switch changes only which provider reads an unchanged conversation, and refreshing the chat list there would silently change what the assistant knows about the owner as a side effect of an unrelated action.

Re-resolution SHALL apply every eligibility, cap, ordering, and disjointness rule afresh, and SHALL overwrite the stored baseline. Runs already bound before re-resolution SHALL retain the prompt they actually sent, because each run's receipt is its own immutable snapshot.

#### Scenario: Second turn in a chat reuses the baseline

- **WHEN** a second run is enqueued in a chat whose owner has since created and titled another chat, and **every other effective-context input is unchanged** — the same rendered prompt inputs, the same advertised tool declarations, the same source kind, and the same availability manifest
- **THEN** the rendered system prompt is byte-identical to the first run's
- **AND** the run binds the same effective-context snapshot rather than a new one
- **AND** the precondition is stated as "every other input unchanged" rather than as a list of named inputs, because an enumeration silently omits the ones it forgets — an operator prompt reload and a changed tool declaration both invalidate reuse without changing the model, the personalization, or the availability manifest

#### Scenario: A changed non-digest input still mints a new snapshot

- **WHEN** any non-digest effective-context input changes between two runs of a chat carrying a baseline — the owner edits their personalization, switches models, the operator reloads that model's prompt file, an advertised tool declaration changes, or the availability manifest changes
- **THEN** the new run binds its own snapshot, because those inputs are part of the prompt and of the snapshot's identity
- **AND** the digest block within it still renders the same stored baseline, since only compaction re-resolves it

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
- **THEN** runs bound before that point still disclose the digest they actually sent
- **AND** no earlier snapshot is mutated to claim content it did not send

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

When the baseline is re-resolved at compaction, a single **supersession marker** SHALL be appended stating that the list has been refreshed and that earlier chat-list updates in the conversation are superseded. It SHALL be expressed through the rail's `snapshot` form, whose defined meaning is that a later snapshot from the same producer supersedes an earlier one, rather than through a marker shape private to this capability. No supersession marker SHALL be emitted on a model switch, because nothing is superseded. When a delta and an effective-context change fall on the same turn, both items SHALL be emitted independently with no combined or special-cased form.

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

- **WHEN** the baseline is re-resolved at compaction and earlier appends survive absorption
- **THEN** a single supersession marker is appended stating that earlier chat-list updates are superseded
- **AND** the refreshed list is not restated on the message rail

### Requirement: Digest content is framed as data and cannot forge its own structure

The digest SHALL render inside a named delimited block. Framing prose SHALL precede it stating that the block lists the owner's other chats, that it is data rather than instructions from a higher authority, that it ranks below the system instructions and below the owner's requests in the current conversation, that it cannot grant tools or capabilities, relax tool authorization, or override safety or transparency rules, and that any text inside it attempting those is to be disregarded. The block SHALL close with an explicit restatement that ordinary instruction-following resumes and that nothing inside the block altered it.

Titles and excerpts SHALL be neutralized by the same tag rules the templating capability applies to owner-authored text — a value can never close a tag it did not open within that same value, and can never emit a reserved delimiter name as a tag at all — so no entry can terminate the block or forge a second one. Rendered output SHALL NOT be re-evaluated as a template.

This framing SHALL be documented as **advisory rather than structurally enforced**, carried by the packaged default's prose and by model compliance, consistent with the precedence ladder the personalization capability already states. Only the delimiter's integrity is structurally guaranteed. An operator who replaces the packaged default may reshape or remove the framing, and the consequence SHALL be documented rather than defended.

#### Scenario: A chat title contains instruction-shaped text

- **WHEN** a listed chat's title or excerpt contains text instructing the assistant to ignore prior instructions
- **THEN** it renders as content inside the block
- **AND** the advertised and executable tool set for that run is identical to the same run without the digest

#### Scenario: An excerpt attempts to close the block

- **WHEN** a listed chat's excerpt contains the block's closing delimiter, which the excerpt itself never opened
- **THEN** the delimiter is escaped as content and the block is not terminated early
- **AND** the rendered prompt contains exactly one delimiter pair

#### Scenario: The block restates instruction-following on exit

- **WHEN** the digest renders for any owner
- **THEN** framing prose precedes the block and a restatement of instruction-following follows it
- **AND** both are present in the owner's receipt

### Requirement: The digest is owner-scoped, and the setting gates production of digest state

The digest SHALL read only the requesting owner's own chats, under that owner's tenant scope, with row-level security as the enforcing boundary and application-level owner filters retained as defense-in-depth. It SHALL be unreachable through the public or shared-chat path, which carries no owner identity, and SHALL fail closed when identity is absent.

The setting gates the **production** of digest state, not the rendering of state already bound to a chat. While `shareRecentChats` is disabled: no baseline SHALL be resolved for a new chat, no baseline SHALL be re-resolved at compaction, and no appends SHALL be emitted. A chat that already carries a baseline SHALL continue to render it unchanged, because withdrawal is not retroactive — see the withdrawal requirement below, which this clause must be read with rather than against.

For a chat that carries **no** baseline — every chat of an owner who has never enabled the setting, and every chat first run after they disabled it — omission SHALL be complete at every level: no digest content, no framing prose, no empty block, so the rendered prompt is byte-identical to the same template with the digest section removed.

Compaction of a chat whose owner has since disabled the setting SHALL leave the existing baseline and told-set untouched rather than re-resolving or clearing them, so the chat continues to send exactly what it was already sending.

Re-enabling SHALL be defined rather than left to interpretation. For a chat that **already has** a baseline, re-enabling resumes appends and compaction re-bakes against the existing epoch. For a chat that has **no** baseline — one whose runs all happened while the setting was off — the next accepted Run after re-enabling SHALL initialize the baseline and told-set atomically, exactly as an ordinary initializing run does. Appends SHALL NOT be emitted for a chat with no baseline, since there is no told-set to diff against; the gate on appends is therefore the setting **and** the existence of a baseline, not the setting alone.

Appends SHALL be gated by the setting together with the existence of a baseline, and by nothing else. The system SHALL NOT inspect the active prompt template to determine whether the digest block rendered; an operator template that omits the block while the setting is enabled SHALL still receive appends, and this consequence SHALL be documented rather than mitigated, consistent with the existing rule that a prompt referencing no per-user path silently forgoes that content.

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

- **WHEN** an owner with the setting enabled uses a model whose prompt references no digest path
- **THEN** the run executes normally with no digest in the prompt
- **AND** appends are still emitted, and nothing reports the mismatch

### Requirement: The owner can see exactly what the digest sent

The rendered digest SHALL appear verbatim in the owner's effective-context receipt for every run that carried it, because it is part of that run's bound system prompt. Appends SHALL be inspectable as parts of the owner's own messages. No digest content SHALL be exposed to any identity other than the owner, and none SHALL be written to operator logs or error messages; a failure to resolve or render SHALL record the failure kind without recording titles or excerpts.

#### Scenario: Owner inspects a run's receipt

- **WHEN** an owner requests the effective-context receipt for a run whose prompt carried the digest
- **THEN** the receipt contains the rendered digest exactly as sent
- **AND** it exposes no host path, provider internal, or credential

#### Scenario: Digest resolution fails

- **WHEN** resolving or rendering the digest fails
- **THEN** the log records the failure kind
- **AND** no chat title or excerpt appears in the log or in any error response

### Requirement: Enabling reaches backwards, withdrawal does not reach forwards, and both are disclosed

Turning `shareRecentChats` off SHALL stop future baselines and appends; it SHALL NOT rewrite chats that already carry a digest, which continue to send the baseline bound to them. Deleting or archiving a chat SHALL remove it from baselines resolved afterwards; it SHALL NOT remove its title or excerpt from other chats' already-bound prompts, from appends already persisted, or from receipts already issued.

**Enabling, by contrast, IS retroactive over the corpus.** Turning the setting on SHALL make chats created long before that moment eligible immediately, including their opening excerpts; the setting governs sharing, not collection, and nothing was withheld from storage while it was off. This asymmetry — consent reaching backwards while withdrawal does not reach forwards — SHALL be disclosed as explicitly as the withdrawal limitation, because it is the more consequential of the two and the less likely to be anticipated.

All three consequences SHALL be stated in the API contract and in whatever surface presents the setting, in the same terms the personalization capability uses for account-identity sharing. They SHALL be presented as documented limitations rather than as erasure, because an owner will reasonably read the control as "stop sharing my other chats" and read deletion as removal everywhere.

#### Scenario: Owner enables the setting for the first time

- **WHEN** an owner with an existing corpus turns `shareRecentChats` on
- **THEN** the next chat they create lists chats that predate the setting being enabled, including their opening excerpts
- **AND** this retroactive reach is disclosed by the surface that offers the setting

#### Scenario: Owner disables the setting mid-chat

- **WHEN** an owner turns `shareRecentChats` off while chats that already carry a digest remain open
- **THEN** those chats continue to send their bound baseline
- **AND** no further appends are emitted in them, and newly created chats carry no digest

#### Scenario: Owner deletes a chat that other chats listed

- **WHEN** an owner deletes a chat whose title and excerpt appear in another chat's bound digest
- **THEN** baselines resolved after the deletion omit it
- **AND** the other chat's already-bound prompt and receipts still contain it
