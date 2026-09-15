## MODIFIED Requirements

### Requirement: The digest is resolved at most once per chat and re-resolved only at compaction

The digest SHALL be resolved on a chat's **first run for which `shareRecentChats` is enabled** and stored as an immutable per-chat baseline, and every subsequent run for that chat SHALL render that stored baseline rather than re-querying the owner's chats. An owner fork that copied a baseline from its source SHALL continue that baseline rather than resolve a new one on its first Run. Rendering the same baseline SHALL be deterministic, so **the digest contributes no per-turn variation to the prompt**: across runs whose other effective-context inputs are unchanged, the resulting system prompt is byte-identical and the snapshot is reused rather than re-minted.

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

#### Scenario: Owner continues a fork

- **WHEN** the fork's first Run follows a baseline copied from the source Chat
- **THEN** it renders that baseline without initializing a new one
- **AND** later appends and compaction in the fork evolve its own copy only
