## ADDED Requirements

### Requirement: Public message locators use immutable Chat-local sequence

Every committed message row in one Chat SHALL have an immutable positive safe-integer `seq` allocated independently from every other Chat. A new Chat's first message SHALL use sequence 1, and each later successfully inserted message SHALL use the next integer in insertion order. Committed rows in a live Chat SHALL therefore occupy one dense `1..N` sequence. Rolled-back or colliding insert attempts SHALL NOT consume a committed sequence value.

The datastore SHALL enforce uniqueness of `(chat_id, seq)`. Product behavior SHALL NOT delete or reorder an individual message row; whole-Chat deletion removes the entire namespace through the existing cascade. An assistant retry that updates an existing row SHALL retain its sequence. A fork SHALL allocate a new Chat-local namespace beginning at 1 while preserving copied message order. Sequence SHALL NOT represent time, branch membership, cross-Chat order, or authority.

An owner-facing conversation source SHALL use `chatId` plus this sequence as positive safe-integer `messageSeq`. Internal message UUID, prior database-wide sequence, JSON part identity, projection row identity, model-facing content hash, visible-text version, embedding identity, score, and owner identity SHALL NOT appear in a newly issued public conversation locator. Current authority comes only from trusted execution context. Search line coordinates SHALL add zero-based `offset` and positive `limit`, and those four fields SHALL be directly accepted by `conversation_read`.

Owner history and public shared-Chat message DTOs SHALL expose this same Chat-local sequence, and their `beforeSeq` cursors SHALL interpret it only inside the named Chat. Public shared pagination SHALL retain its existing text-only egress allowlist, public-visibility check, no-store behavior, and empty-identity RLS path; changing sequence allocation SHALL NOT grant target-mode access, owner metadata, reasoning, tool parts, or private-Chat existence.

Every durable Run queue payload carrying a triggering message sequence SHALL validate it as a positive safe integer before execution. Zero, negative, fractional, non-finite, or unsafe values SHALL fail queue parsing before they can bound history, select a compaction, or enter a tool locator.

Where chronology navigation is returned, `previousMessageSeq` and `nextMessageSeq` SHALL identify the closest currently readable eligible messages under current owner scope. The caller SHALL NOT infer eligibility from arithmetic: an intervening system/tool row or retryable assistant row MAY occupy an adjacent committed sequence while remaining unavailable to evidence reads.

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
- **THEN** queue parsing rejects the job before Run execution reads Chat history or compaction state
- **AND** the invalid value is not coerced into a local message locator

#### Scenario: Ineligible adjacent rows do not redefine evidence navigation

- **WHEN** an unreadable message row occupies the sequence immediately before or after a readable source
- **THEN** returned previous/next navigation identifies the nearest eligible source under current owner scope
- **AND** the caller does not infer readability from `messageSeq - 1` or `messageSeq + 1`

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

### Requirement: Owner-facing message links use the Chat-local sequence locator

The owner Chat surface SHALL address a message target as `/chat/<chatId>#msg-<messageSeq>`, where `messageSeq` is the immutable one-based sequence local to that Chat. For a hash-targeted initial load, the client SHALL request a strict positive-safe-integer `targetSeq` mode on the existing owner message-history surface. `targetSeq` and `beforeSeq` SHALL be mutually exclusive. Fractional, zero, negative, unsafe, malformed, or unknown query values SHALL fail strict validation before repository access. A valid positive safe integer whose target is missing, public/shared-only, or owned by another user SHALL follow the same closed not-found path. The server SHALL first verify that the exact target exists under current owner scope, then return the normal fixed-size chronological window ending at that target sequence. The client SHALL keep target-mode history under a distinct query/cache identity, render and scroll to the target, and continue older pagination through the existing Chat-local `beforeSeq` cursor. Clearing the hash SHALL reinitialize the ordinary newest window rather than silently merging unseen newer messages into or reinterpreting the targeted cache.

Rendered owner messages SHALL expose the stable `msg-<messageSeq>` anchor without exposing internal message UUIDs or prior database-wide sequence values. This change SHALL NOT add a copy-link affordance. Target loading SHALL resolve current owner access independently and reveal no foreign target existence. The URL is navigation only and SHALL NOT grant `conversation_read` authority.

#### Scenario: Copied owner link reaches its Chat-local message

- **WHEN** an owner opens a copied canonical link to an eligible message outside the initially loaded page
- **THEN** `targetSeq` returns the owner-authorized history window ending at that exact Chat-local sequence and the Chat scrolls to `msg-<messageSeq>`
- **AND** the visible target is the same message addressed by `conversation_read`

#### Scenario: Target and ordinary cursor cannot mix

- **WHEN** one owner history request supplies both `targetSeq` and `beforeSeq`
- **THEN** strict query validation rejects it before reading message history
- **AND** no ambiguous pagination mode reaches the repository

#### Scenario: Invalid target sequence fails before lookup

- **WHEN** `targetSeq` is fractional, zero, negative, unsafe, malformed, or accompanied by an unknown query property
- **THEN** strict query validation rejects the request before repository access
- **AND** the failure is distinct from the closed not-found response for a valid inaccessible target

#### Scenario: Target window does not alias newest-window cache

- **WHEN** an owner enters a deep link after the ordinary newest history was cached
- **THEN** target-mode state uses a distinct cache identity whose page zero is the target-ended window
- **AND** clearing the hash restores the ordinary newest-window query without merging the two page orders

#### Scenario: Foreign target is not disclosed

- **WHEN** a signed-in owner opens a well-formed target that exists only in another owner's Chat
- **THEN** the owner surface follows its ordinary not-found behavior
- **AND** no foreign message metadata or content enters the response

#### Scenario: Small target value is scoped by Chat

- **WHEN** two Chats both contain `messageSeq: 3`
- **THEN** each URL and target request resolves sequence 3 only inside its named Chat
- **AND** neither locator implies cross-Chat identity or authority

## REMOVED Requirements

### Requirement: Public message locators use stable sparse sequence

**Reason**: Public locators no longer expose the sparse database-wide identity. They use the immutable dense insertion sequence local to one append-only Chat.

**Migration**: Quiesce Run admission, drain accepted Runs, rewrite existing message and compaction boundaries deterministically into Chat-local order, then deploy the matching API/worker revision before resuming.

### Requirement: Owner-facing message links use the same sequence locator

**Reason**: Message links now explicitly address the immutable one-based sequence local to a Chat and no longer permit sparse/global locator semantics.

**Migration**: Deploy the rewritten Chat-local message/history sequence surface atomically with the data cutover; clients discard ephemeral pre-cutover history cursors and reload target windows.
