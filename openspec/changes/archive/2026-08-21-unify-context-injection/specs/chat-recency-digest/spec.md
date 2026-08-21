## MODIFIED Requirements

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
