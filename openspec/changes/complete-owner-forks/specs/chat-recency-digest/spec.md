## MODIFIED Requirements

### Requirement: The digest is resolved at most once per chat and re-resolved only at compaction

The digest SHALL be resolved on a chat's **first run for which `shareRecentChats` is enabled** and stored as an immutable per-chat baseline, and every subsequent run for that chat SHALL render that stored baseline rather than re-querying the owner's chats. An owner fork with an inherited baseline SHALL continue that baseline rather than resolve a new one on its first local Run. Copying already-bound owner history SHALL NOT resolve new corpus content or create a new disclosure epoch.

Rendering the same baseline SHALL be deterministic, so **the digest contributes no per-turn variation to the prompt**: across runs whose other effective-context inputs are unchanged, the resulting system prompt is byte-identical and the snapshot is reused rather than re-minted.

The stability claim is scoped to the digest and SHALL NOT be read as a guarantee over the whole prompt. Personalization resolves per run, the selected model supplies the template, the operator may reload a prompt file, and the tool-availability manifest is part of the snapshot's identity, so any of those changing legitimately mints a new snapshot, exactly as `model-system-prompts` requires. What this requirement forbids is the digest itself being the thing that changes.

The baseline SHALL be re-resolved **only when that chat is compacted**. A model switch SHALL NOT re-resolve it: the stored baseline SHALL be re-rendered through the new model's template, so the prompt text changes while the listed chats do not. The rationale SHALL be documented: compaction is a context boundary at which the conversation is rewritten anyway, whereas a model switch changes only which provider reads an unchanged conversation, and refreshing the chat list there would silently change what the assistant knows about the owner as a side effect of an unrelated action.

Re-resolution SHALL apply every eligibility, cap, ordering, and disjointness rule afresh, and SHALL overwrite the stored baseline. Runs already bound before re-resolution SHALL retain the prompt they actually sent, because each run's receipt is its own immutable snapshot. Boundary-specific historical state retained for owner forks SHALL likewise remain unchanged.

#### Scenario: Second turn in a chat reuses the baseline

- **WHEN** a second run is enqueued in a chat whose owner has since created and titled another chat, and **every other effective-context input is unchanged**: the same rendered prompt inputs, the same advertised tool declarations, the same source kind, and the same availability manifest
- **THEN** the rendered system prompt is byte-identical to the first run's
- **AND** the run binds the same effective-context snapshot rather than a new one
- **AND** the precondition is stated as "every other input unchanged" rather than as an exhaustive list, because an operator prompt reload and a changed tool declaration both invalidate reuse without changing the model, the personalization, or the availability manifest

#### Scenario: A changed non-digest input still mints a new snapshot

- **WHEN** any non-digest effective-context input changes between two runs of a chat carrying a baseline: the owner edits their personalization, switches models, the operator reloads that model's prompt file, an advertised tool declaration changes, or the availability manifest changes
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

- **WHEN** the fork's first local Run follows an inherited digest baseline
- **THEN** it renders that baseline without initializing a new one
- **AND** ordinary future appends and local compaction use the fork's own evolving state

## ADDED Requirements

### Requirement: Owner forks preserve boundary-specific digest state

An owner fork SHALL inherit the selected boundary's baseline, told-set, and pending re-bake disclosure state together. The system SHALL retain sufficient historical state when a turn or compaction changes these values so a later historical fork cannot accidentally inherit state from excluded messages or a later compaction. It SHALL NOT recover missing structured state by parsing rendered prompts, checkpoint summaries, or reminder prose.

The copied told-set SHALL continue to identify the same external chats; allocating a new current Chat SHALL NOT rewrite those identities. Copying already-bound state remains permitted after consent withdrawal, consistent with non-retroactive withdrawal; resolving new baselines, appends, and re-bakes SHALL still obey current consent. No digest state SHALL cross the shared/public fork boundary.

#### Scenario: Historical fork precedes an append

- **WHEN** a source chat disclosed a new digest entry after the selected message
- **THEN** the fork inherits the earlier told-set
- **AND** the excluded append cannot suppress an otherwise eligible future disclosure in the fork

#### Scenario: Historical fork precedes a re-bake

- **WHEN** the source replaced its baseline at a later compaction
- **THEN** the fork inherits the baseline applicable at its selected boundary
- **AND** it does not copy the source's later baseline merely because it is currently stored on the Chat

#### Scenario: Monday's pinned state is stale by Wednesday

- **WHEN** the owner forks Monday's retained boundary after the source refreshed its digest on Tuesday
- **THEN** the fork preserves Monday's pinned baseline and told-set
- **AND** their age does not reject the fork, refresh them, or create a fork notice

#### Scenario: A re-bake notice is pending at the selected boundary

- **WHEN** an applicable compaction refreshed the digest but no included user turn has yet carried the corresponding supersession notice
- **THEN** the fork retains the same pending notice state
- **AND** its next ordinary eligible turn emits that notice once

#### Scenario: Owner disabled sharing after history was bound

- **WHEN** that owner forks history that already contains a digest while sharing is disabled
- **THEN** the inherited baseline and evidence remain intact
- **AND** the fork resolves no new digest content or appends while sharing remains disabled
