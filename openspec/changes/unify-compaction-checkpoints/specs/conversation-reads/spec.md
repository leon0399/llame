# Spec Delta

## MODIFIED Requirements

### Requirement: Public message locators use immutable Chat-local sequence

Every committed message row in one Chat SHALL have an immutable positive safe-integer `seq` allocated independently from every other Chat. A new Chat's first message SHALL use sequence 1, and each later successfully inserted message SHALL use the next integer in insertion order. Committed rows in a live Chat SHALL therefore occupy one dense `1..N` sequence. A committed `checkpoint` row occupies a sequence value like any other committed row. Rolled-back or colliding insert attempts SHALL NOT consume a committed sequence value.

The datastore SHALL enforce uniqueness of `(chat_id, seq)`. Product behavior SHALL NOT delete or reorder an individual message row; whole-Chat deletion removes the entire namespace through the existing cascade. An assistant retry that updates an existing row SHALL retain its sequence. A fork SHALL allocate a new Chat-local namespace beginning at 1 while preserving copied message order. Sequence SHALL NOT represent time, branch membership, cross-Chat order, or authority.

An owner-facing conversation source SHALL use `chatId` plus this sequence as positive safe-integer `messageSeq`. Internal message UUID, prior database-wide sequence, JSON part identity, projection row identity, model-facing content hash, visible-text version, embedding identity, score, and owner identity SHALL NOT appear in a newly issued public conversation locator. Current authority comes only from trusted execution context. Search line coordinates SHALL add zero-based `offset` and positive `limit`, and those four fields SHALL be directly accepted by `conversation_read`.

Owner history and public shared-Chat message DTOs SHALL expose this same Chat-local sequence, and their `beforeSeq` cursors SHALL interpret it only inside the named Chat. Public shared pagination SHALL retain its existing text-only egress allowlist, public-visibility check, no-store behavior, and empty-identity RLS path; changing sequence allocation SHALL NOT grant target-mode access, owner metadata, reasoning, tool parts, or private-Chat existence.

Every durable Run queue payload carrying a triggering message sequence SHALL validate it as a positive safe integer before execution. Zero, negative, fractional, non-finite, or unsafe values SHALL fail queue parsing before they can bound history, select a checkpoint, or enter a tool locator.

Where chronology navigation is returned, `previousMessageSeq` and `nextMessageSeq` SHALL identify the closest currently readable eligible messages under current owner scope. The caller SHALL NOT infer eligibility from arithmetic: an intervening system/tool row, `checkpoint` row, or retryable assistant row MAY occupy an adjacent committed sequence while remaining unavailable to evidence reads. A `checkpoint` row SHALL never be an addressable conversation source under any owner scope, and its sequence SHALL be skipped by chronology navigation exactly as a system or tool row is.

#### Scenario: Two Chats start independent namespaces

- **WHEN** messages are appended to two newly created Chats
- **THEN** each Chat allocates its own sequence beginning at 1 and increasing in committed insertion order
- **AND** no sequence value in one Chat changes allocation in the other

#### Scenario: Concurrent inserts remain dense and unique

- **WHEN** ordinary runtime writers race to append messages to the same Chat
- **THEN** the committed rows receive distinct consecutive Chat-local sequences
- **AND** collision handling neither exposes a duplicate nor consumes an uncommitted gap

#### Scenario: Search result is directly readable

- **WHEN** model-facing lexical search returns a canonical-derived passage
- **THEN** it identifies the Chat, Chat-local message sequence, zero-based line offset, and positive line limit
- **AND** those fields are valid `conversation_read` arguments without a part ID, message UUID, prior global sequence, hash, version, or range discriminator

#### Scenario: Public shared history uses the same local cursor

- **WHEN** an anonymous reader paginates a public Chat with `beforeSeq`
- **THEN** message DTOs and cursors use that Chat's one-based local sequence
- **AND** the public path exposes no private Chat, owner-only target mode, reasoning, tool part, or owner identity

#### Scenario: Invalid queued sequence fails before history access

- **WHEN** a durable Run job carries zero, negative, fractional, non-finite, or unsafe `userMessage.seq`
- **THEN** queue parsing rejects the job before Run execution reads Chat history or checkpoint state
- **AND** the invalid value is not coerced into a local message locator

#### Scenario: Ineligible adjacent rows do not redefine evidence navigation

- **WHEN** an unreadable message row occupies the sequence immediately before or after a readable source
- **THEN** returned previous/next navigation identifies the nearest eligible source under current owner scope
- **AND** the caller does not infer readability from `messageSeq - 1` or `messageSeq + 1`

#### Scenario: A checkpoint row is addressable to nobody

- **WHEN** a locator names the Chat-local sequence of a committed `checkpoint` row
- **THEN** the reader returns `conversation_source_not_found`
- **AND** adjacent navigation skips that sequence exactly as it skips a system or tool row, while the sequence itself stays consumed

#### Scenario: Retry retains its message sequence

- **WHEN** the existing retry path replaces the content of an eligible assistant row in place
- **THEN** that row retains its original Chat-local sequence
- **AND** no later message is renumbered

#### Scenario: Fork starts an independent namespace

- **WHEN** an owner forks a source Chat prefix into a different Chat
- **THEN** copied messages receive sequences `1..N` in the same relative order inside the fork
- **AND** source-Chat selectors are not portable to the fork by sequence alone

#### Scenario: Whole-Chat deletion removes the namespace

- **WHEN** an owner deletes a Chat
- **THEN** the existing cascade removes all of its messages and their sequence namespace together
- **AND** no product operation deletes one middle message or renumbers surviving messages
