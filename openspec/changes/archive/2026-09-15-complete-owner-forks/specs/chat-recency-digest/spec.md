## MODIFIED Requirements

### Requirement: Committed digest baselines remain stable until compaction

The digest SHALL be resolved for an initializing execution attempt with `shareRecentChats` enabled and stored as an immutable per-chat baseline only on its successful turn, and every subsequent run for that chat SHALL render that stored baseline rather than re-querying the owner's chats. Rendering the same baseline SHALL be deterministic, so **the digest contributes no per-turn variation to the prompt**: across runs whose other effective-context inputs are unchanged, the resulting system prompt is byte-identical and the prompt text/hash is unchanged, although each attempt has its own receipt. An owner fork that copied a baseline from its source SHALL continue that baseline rather than resolve a new one on its first Run.

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

#### Scenario: Owner continues a fork

- **WHEN** the fork's first Run follows a baseline copied from the source Chat
- **THEN** it renders that baseline without initializing a new one
- **AND** later appends and compaction in the fork evolve its own copy only
