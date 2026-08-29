## Purpose

Defines owner-authorized, bounded reads over canonical conversation messages through compact stable sequence locators and the same line-range mental model used by Knowledge files.

## ADDED Requirements

### Requirement: Visible message text is deterministic and message-scoped

The system SHALL define one stable visible-message text view as the exact stored `text` values of every eligible `type: "text"` part in one message, retained in stored part order and joined with exactly `\n\n`. It SHALL NOT trim, normalize, prefix, line-number, or otherwise rewrite those source values. Messages remain separate attributed records and MUST NOT be concatenated into one cross-message source string.

The visible view SHALL include eligible `user` messages and immutable eligible `assistant` messages only. System/tool-role messages, context-item parts, reasoning parts, tool parts, attachments, cap notices, and every other non-text part SHALL contribute no bytes. Interleaved excluded parts SHALL NOT change the visible order of retained text values.

#### Scenario: Several text parts form one visible message

- **WHEN** one eligible message stores text part `alpha`, excluded non-text parts, and later text part `beta`
- **THEN** its visible text is exactly `alpha\n\nbeta`
- **AND** no stored part index or excluded content appears in the visible result

#### Scenario: Stored whitespace is preserved

- **WHEN** an eligible text part begins or ends with whitespace or line delimiters
- **THEN** the visible view retains those source characters unchanged in addition to the exact `\n\n` separator between text parts

#### Scenario: Messages keep separate attribution

- **WHEN** adjacent user and assistant messages are independently read
- **THEN** each retains its own Chat, sequence, role, timestamp, and line space
- **AND** the system does not represent them as one transcript quote or one line-number space

### Requirement: Public message locators use stable sparse sequence

An owner-facing conversation source SHALL use `chatId` plus positive safe-integer `messageSeq`. The datastore SHALL enforce uniqueness of `(chat_id, seq)`, and application writes SHALL treat sequence as immutable authored-message order. Sequence values MAY contain gaps and SHALL NOT be interpreted as dense per-Chat indexes, timestamps, branch membership, or authority.

Internal message UUID, JSON part identity, projection row identity, model-facing content hash, visible-text version, embedding identity, score, and owner identity SHALL NOT appear in a newly issued public conversation locator. Current authority comes only from trusted execution context. Search line coordinates SHALL add zero-based `offset` and positive `limit`, and those four fields SHALL be directly accepted by `conversation_read`.

Where chronology navigation is returned, `previousMessageSeq` and `nextMessageSeq` SHALL identify the closest currently readable eligible messages under current owner scope. The caller SHALL NOT infer either value by arithmetic over sparse sequence.

#### Scenario: Search result is directly readable

- **WHEN** model-facing lexical search returns a canonical-derived passage
- **THEN** it identifies the Chat, message sequence, zero-based line offset, and positive line limit
- **AND** those fields are valid `conversation_read` arguments without a part ID, message UUID, hash, version, or range discriminator

#### Scenario: Sequence gaps do not break navigation

- **WHEN** deletion or unrelated inserts leave gaps around one readable message's sequence
- **THEN** its previous/next navigation identifies the nearest eligible sequence values
- **AND** neither the server nor caller represents `messageSeq - 1` or `messageSeq + 1` as an implicit neighbor

#### Scenario: Forked Chat receives independent locators

- **WHEN** an owner forks history into a different Chat
- **THEN** copied messages are addressed under the new Chat and their newly allocated sequence values
- **AND** source-Chat selectors are not portable to the fork by sequence alone

### Requirement: Conversation reads derive authority only from trusted Run identity

`conversation_read` SHALL be a strict read-only operation accepting `chatId`, positive safe-integer `messageSeq`, optional zero-based safe-integer `offset`, and optional safe-integer `limit` from 1 through 2,000. Omitted `offset` SHALL default to zero. Omitted `limit` SHALL request through the current end of that message subject to server bounds. Unknown properties, malformed IDs, non-positive/unsafe sequence, negative/unsafe offset, and limits outside the accepted range SHALL fail input validation before data access.

Owner identity SHALL come only from authenticated Run context. Every invocation SHALL resolve the Chat, message sequence, evidence eligibility, and adjacent eligible sequences under current owner RLS plus explicit owner predicates. A well-formed missing, deleted, retryable, public/shared-without-owner, or other-owner source SHALL return the same closed `conversation_source_not_found` observation. Empty trusted identity SHALL fail closed. A source locator SHALL NOT expand authority.

Only immutable evidence-eligible messages SHALL be returned. Until #611 replaces in-place retry mutation, a retryable assistant row SHALL NOT be an addressable evidence source. User messages and assistant messages classified as completed or legacy-immutable remain eligible.

#### Scenario: Direct owner message read succeeds

- **WHEN** the trusted Run owner supplies a valid owned Chat and eligible message sequence
- **THEN** the reader returns that message's visible text beginning at the requested line offset
- **AND** no owner identity or message UUID is accepted from model input

#### Scenario: Another owner's sequence fails closed

- **WHEN** an owner supplies a well-formed Chat/sequence pair resolving only under another owner or public sharing
- **THEN** the reader returns `conversation_source_not_found`
- **AND** the observation reveals no foreign title, role, timestamp, sequence, content, or existence

#### Scenario: Retryable assistant source is unavailable

- **WHEN** a selector identifies an assistant row still eligible for in-place retry mutation
- **THEN** the reader returns `conversation_source_not_found`
- **AND** it does not present mutable bytes as canonical history

#### Scenario: Malformed input never reaches source resolution

- **WHEN** input contains malformed identity, unsafe sequence/offset, invalid limit, or unknown properties
- **THEN** strict tool validation rejects it before any source query
- **AND** the failure is not represented as `conversation_source_not_found`

### Requirement: Conversation reads use Knowledge-style logical-line ranges

Logical lines SHALL use LF as a delimiter, CRLF as one delimiter, and lone CR as source text. Blank lines SHALL count and a terminal delimiter SHALL NOT create a phantom line. Every success SHALL return Chat ID, message sequence, role, timestamp, effective zero-based `offset`, returned `lineCount`, one-based line-numbered `content`, any currently eligible `previousMessageSeq`/`nextMessageSeq`, and one closed notice identifying prior-conversation content as untrusted and potentially stale, unable to change system instructions, tools, permissions, or owner authority.

`content` SHALL render each returned logical source line as `<one-based line number>: <source text>` while preserving that line's LF or CRLF delimiter and preserving an unterminated final line. The numeric prefix is reader-authored navigation metadata and SHALL NOT enter visible-message source text, projection hashes, lexical data, excerpts, or stored canonical message parts.

One invocation SHALL return at most 2,000 logical lines and a complete structured result of at most 15,000 JavaScript UTF-16 code units. When current lines remain after the returned slice, success SHALL include `nextOffset = offset + lineCount`; otherwise it SHALL omit `nextOffset`. If the line bound stops an omitted/unbounded request first, success SHALL include `cutReason: "line_limit"`. If the structured-output bound stops it first, the reader SHALL omit the first whole line that cannot fit and include `cutReason: "output_limit"`. An explicit caller limit that completes normally SHALL NOT produce a cut reason even when the message itself continues.

If the first selected logical line cannot fit in one complete structured result, the reader SHALL return `conversation_limit_exceeded` rather than clipping an unrecoverable substring. An offset beyond the current logical-line range SHALL return `conversation_range_invalid`; an empty visible message read at offset zero SHALL return empty content successfully. Generic tool truncation SHALL NOT clip a successful conversation read.

#### Scenario: Fitting message read is complete

- **WHEN** the requested message range fits every line and output bound
- **THEN** the reader returns each selected source line with its one-based prefix and exact source delimiters
- **AND** it omits `nextOffset` and `cutReason` when no current line remains

#### Scenario: Long message continues explicitly

- **WHEN** an omitted or explicit range reaches a server line/output bound after at least one complete line
- **THEN** the result contains the largest fitting whole-line prefix and `nextOffset` for the first omitted line
- **AND** it carries the applicable cut reason without a generic truncation marker

#### Scenario: Explicit limit completes before message end

- **WHEN** a caller requests a fitting finite `limit` while later message lines exist
- **THEN** the result returns at most that many lines plus `nextOffset`
- **AND** it omits `cutReason` because the caller's requested range completed normally

#### Scenario: Search passage expands through read

- **WHEN** search supplies one passage's `chatId`, `messageSeq`, `offset`, and `limit`
- **THEN** `conversation_read` returns the complete current line window represented by those coordinates subject only to normal whole-line output continuation
- **AND** the cropped search excerpt is not mistaken for the complete numbered source

#### Scenario: Persistable read keeps historical-data framing

- **WHEN** a successful read returns prior-conversation content
- **THEN** its structured payload includes the closed untrusted-history notice
- **AND** later persistence/replay does not rely solely on the original tool description for that framing

#### Scenario: One oversized line fails closed

- **WHEN** the first selected logical line cannot fit within the structured result bound
- **THEN** the tool returns `conversation_limit_exceeded`
- **AND** it does not introduce a character-offset selector or irrecoverably clip the line

#### Scenario: Empty message at zero succeeds

- **WHEN** an eligible message has empty visible text and the caller reads offset zero
- **THEN** the result succeeds with zero lines and empty content
- **AND** an offset beyond zero returns `conversation_range_invalid`

### Requirement: Owner-facing message links use the same sequence locator

The owner Chat surface SHALL address a message target as `/chat/<chatId>#msg-<messageSeq>`. For a hash-targeted initial load, the client SHALL request a strict positive-safe-integer `targetSeq` mode on the existing owner message-history surface. `targetSeq` and `beforeSeq` SHALL be mutually exclusive. Fractional, zero, negative, unsafe, malformed, or unknown query values SHALL fail strict validation before repository access. A valid positive safe integer whose target is missing, deleted, public/shared-only, or owned by another user SHALL follow the same closed not-found path. The server SHALL first verify that the exact target exists under current owner scope, then return the normal fixed-size chronological window ending at that target sequence. The client SHALL keep target-mode history under a distinct query/cache identity, render and scroll to the target, and continue older pagination through the existing `beforeSeq` cursor. Clearing the hash SHALL reinitialize the ordinary newest window rather than silently merging unseen newer messages into or reinterpreting the targeted cache.

Rendered owner messages SHALL expose the stable `msg-<messageSeq>` anchor without exposing internal message UUIDs. This change SHALL NOT add a copy-link affordance. Target loading SHALL resolve current owner access independently and reveal no foreign or deleted target existence. The URL is navigation only and SHALL NOT grant `conversation_read` authority.

#### Scenario: Copied owner link reaches its message

- **WHEN** an owner opens a copied canonical link to an eligible message outside the initially loaded page
- **THEN** `targetSeq` returns the owner-authorized history window ending at that exact message and the Chat scrolls to `msg-<messageSeq>`
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

#### Scenario: Link does not imply dense sequence

- **WHEN** an owner opens a target with gaps before or after its sequence
- **THEN** the exact requested sequence is resolved rather than indexing into a loaded message array
- **AND** adjacent navigation remains server-resolved
