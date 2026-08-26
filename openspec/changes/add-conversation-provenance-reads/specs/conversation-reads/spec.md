## Purpose

Defines owner-authorized, bounded reads over canonical conversation messages, including stable message-oriented source references, exact visible-text line ranges with a server-issued mid-line offset fallback, oversized-message navigation, and safe historical tool-activity metadata.

## ADDED Requirements

### Requirement: Visible message text is deterministic and message-scoped

The system SHALL define `visibleMessageText` version 1 as the exact stored `text` values of every eligible `type: "text"` part in one message, retained in stored part order and joined with exactly `\n\n`. It SHALL NOT trim, normalize, prefix, line-number, or otherwise rewrite those values. Messages SHALL remain separate attributed records and MUST NOT be concatenated into one cross-message string.

The visible view SHALL include eligible `user` messages and immutable eligible `assistant` messages only. System/tool-role messages, context-item parts, reasoning parts, tool parts, attachments, cap notices, and every other non-text part SHALL contribute no bytes. Interleaved excluded parts SHALL NOT change the visible order of the retained text values. Newly produced source references and read results SHALL identify visible-text version 1.

#### Scenario: Several text parts form one visible message

- **WHEN** one eligible message stores text part `alpha`, excluded non-text parts, and later text part `beta`
- **THEN** its version-1 visible text is exactly `alpha\n\nbeta`
- **AND** no stored part index or excluded content appears in the visible result

#### Scenario: Stored whitespace is preserved

- **WHEN** an eligible text part begins or ends with whitespace or line delimiters
- **THEN** the visible view retains those bytes unchanged in addition to the exact `\n\n` separator between text parts

#### Scenario: Messages keep separate attribution

- **WHEN** a bounded read returns adjacent user and assistant messages
- **THEN** each retains its own message ID, role, timestamp, and visible-text slices
- **AND** the system does not represent the two messages as one quote or one line-number space

### Requirement: Conversation source references are structured message locators

A newly issued conversation source reference SHALL be a structured version-1 locator containing the chat ID and exactly one discriminated range form:

- `messages`: ordered start/end message IDs addressing complete boundary messages;
- `lines`: ordered start/end message IDs plus a zero-based start line and exclusive end line; or
- `text`: ordered start/end message IDs plus a zero-based UTF-16 start offset and exclusive end offset into the corresponding version-1 visible-message views.

Every selected form SHALL require both of its boundary identities and both or neither of its coordinate fields; partial, mixed, or unknown range forms fail input validation. A source reference SHALL contain no owner identity, JSON part identity, projection row identity, model-facing content hash, embedding identity, score, or authorization grant.

The start/end identities SHALL describe one forward range in canonical message `seq` order. A single-message line/text range SHALL use the same message at both boundaries. A multi-message line/text range SHALL apply its start coordinate to the first message and exclusive end coordinate to the last message; intermediate messages are complete. Line ranges are the normal model-facing navigation form. Text-offset ranges exist only so a server-issued projection locator can preserve exact source boundaries that fall inside a logical line. The reference version SHALL define visible-text serialization and coordinate interpretation.

#### Scenario: Content search issues a line-bounded reference

- **WHEN** content discovery returns an exact passage from one message
- **THEN** its source reference identifies version 1, the owning chat, that message as both boundaries, and the passage's half-open line range
- **AND** it contains no part index or content hash

#### Scenario: Mid-line chunk issues a text-bounded reference

- **WHEN** one retrieved chunk starts or ends inside a logical source line
- **THEN** its source reference uses the complete V1 `text` range with exact UTF-16 boundary offsets
- **AND** a later read can round-trip those exact source bytes without expanding to an oversized whole line

#### Scenario: Incomplete coordinate form is invalid

- **WHEN** a source reference supplies only one line/offset boundary, mixes line and text coordinates, or omits a required boundary message ID
- **THEN** strict input validation rejects it before data access

#### Scenario: Timeline discovery issues a message-bounded reference

- **WHEN** queryless timeline discovery identifies activity between two eligible messages
- **THEN** its source reference identifies the chat and ordered boundary message IDs without inventing a quote, line match, or content hash

#### Scenario: Unsupported source-reference version fails visibly

- **WHEN** the reader receives a source reference whose version it does not support
- **THEN** it returns `conversation_source_version_unsupported`
- **AND** it does not reinterpret the coordinates under the current version

### Requirement: Conversation reads derive authority only from trusted Run identity

`read_conversation_range` SHALL be a strict read-only operation accepting exactly one of: a server-issued conversation source reference, or a direct owner-facing selector containing `chatId` and `messageId` plus either both or neither of a zero-based `startLine` and positive `lineCount`. Direct selectors SHALL NOT accept text offsets. Either form MAY request zero through five surrounding eligible messages before and after the selected source. Unknown properties, mixed selector forms, malformed IDs, partial line selectors, negative or unsafe coordinates, a non-positive line count, or surrounding-message values outside zero through five SHALL fail input validation before data access.

Owner identity SHALL come only from the authenticated Run context. Every invocation SHALL resolve the selected chat and messages under current owner RLS plus explicit owner predicates. A well-formed missing, deleted, public/shared-without-owner, or other-owner source SHALL return the same closed `conversation_source_not_found` observation. Malformed selectors never reach this resolution path. Empty trusted identity SHALL fail closed. A source reference is a locator and SHALL NOT expand authority.

Only immutable evidence-eligible messages SHALL be returned. Until message-revision semantics replace in-place retry mutation, a retryable assistant row SHALL NOT be an addressable evidence source. User messages and assistant messages the application classifies as completed or legacy-immutable remain eligible.

#### Scenario: Direct message link needs no part selector

- **WHEN** the owner supplies a valid chat ID and eligible message ID without a line range
- **THEN** the reader selects that message's complete visible-text view subject to the bounded-output behavior below
- **AND** it does not ask for or return a part identity

#### Scenario: Another owner's locator fails closed

- **WHEN** a Run supplies another owner's valid chat and message identities
- **THEN** datastore-backed authorization returns `conversation_source_not_found`
- **AND** the result does not reveal whether either identity exists

#### Scenario: Retryable assistant row is not evidence

- **WHEN** a source locator identifies an assistant message that remains eligible for in-place retry mutation
- **THEN** the reader returns `conversation_source_not_found`
- **AND** no mutable partial answer is presented as stable historical evidence

#### Scenario: Deleted source fails explicitly

- **WHEN** an owner-authorized source is deleted before a later read
- **THEN** the later invocation returns `conversation_source_not_found`
- **AND** it does not substitute projection bytes or another message

### Requirement: Read results preserve exact text with bounded line and message navigation

Logical lines SHALL use LF as a delimiter, CRLF as one delimiter, and a lone CR as source text. A terminal delimiter SHALL NOT create a phantom line. Every success SHALL return ordered message records containing message ID, role, timestamp, visible-text version, and zero or more exact source slices. Selected source and surrounding-context messages SHALL use this same slice structure; a context slice is exact historical text but is not represented as the discovery passage that selected the source. A normal line slice SHALL contain zero-based `startLine`, returned `lineCount`, and raw visible text with its original delimiters. A slice resolving a server-issued `text` source SHALL instead contain zero-based `startOffset`, exclusive `endOffset`, and the exact raw visible-text substring. The text SHALL NOT contain generated line-number prefixes. The response MAY additionally expose `previous` and `next` selectors that are directly valid inputs for another bounded call.

One invocation SHALL return at most 20 eligible messages, at most 2,000 logical source lines, and a complete structured result of at most 15,000 JavaScript UTF-16 code units. The reader SHALL preflight its result below the common generic tool-result cap. It SHALL return the largest fitting whole-line source prefix and a deterministic next selector when more requested source remains; it MUST NOT let generic truncation silently clip a citation-grade slice. Requested surrounding context SHALL yield to retaining the selected source region, and omitted requested context SHALL be identified by `complete: false` and navigation metadata rather than silently disappearing.

If the first selected logical line of a direct/line read cannot fit as a complete exact source line, the reader SHALL return `conversation_limit_exceeded`. A server-issued text-offset source that fits the result bound SHALL remain readable even when its containing line does not. A line/text range outside the current visible view SHALL return `conversation_range_invalid`; an empty visible message at line zero SHALL return an empty success. Newly returned source bytes SHALL carry no model-facing hash.

#### Scenario: Small message returns complete visible text

- **WHEN** a directly selected message and its requested context fit every bound
- **THEN** the reader returns all selected exact visible text with `complete: true`
- **AND** it omits continuation metadata

#### Scenario: Long message continues without generic truncation

- **WHEN** a selected message reaches the line or structured-output bound before its requested end
- **THEN** the result contains the largest fitting exact whole-line prefix, `complete: false`, and a next selector at the first omitted line
- **AND** the result carries no generic `truncated` or `truncationNotice` field

#### Scenario: Explicit line range is directly reusable

- **WHEN** a call supplies a valid message-relative `startLine` and `lineCount`
- **THEN** the returned slice starts at that source line and contains at most the requested number of complete lines
- **AND** any next selector points to the first requested source line not returned

#### Scenario: One oversized line fails closed

- **WHEN** a direct or line-bounded read selects a first logical line that cannot fit and no server-issued bounded text range narrows it
- **THEN** the tool returns `conversation_limit_exceeded`
- **AND** it does not clip the line or invent a text range

#### Scenario: Bounded text source remains readable inside an oversized line

- **WHEN** a valid server-issued text-offset source fits the result bound but its containing logical line does not
- **THEN** the result returns the exact offset-bounded substring with its start/exclusive-end offsets
- **AND** it does not expand to or clip the containing line

### Requirement: Oversized Markdown-shaped messages provide deterministic navigation

When a directly selected complete message cannot fit in one successful result, the reader SHALL return a bounded deterministic outline alongside its initial exact slice. The outline SHALL contain ordered recognized Markdown headings outside fenced code, each with heading depth, zero-based source line, and exact heading text. It SHALL be derived on demand from the current visible message and SHALL NOT require or create a persisted table of contents, synopsis, or second content projection.

The outline SHALL remain optional data: a message with no recognized headings or malformed Markdown SHALL still return the same bounded exact slice and continuation behavior with an empty outline. Search results and ordinary fitting reads SHALL NOT carry a full message outline. Outline text is navigation metadata, not quoted source content.

#### Scenario: Giant Markdown answer returns an outline and initial slice

- **WHEN** a direct complete-message read selects an oversized assistant answer with recognized headings
- **THEN** the result contains a bounded ordered heading outline, the initial exact line slice, and a next selector
- **AND** a later call can use a heading's line as its direct `startLine`

#### Scenario: Heading-like code is not navigation

- **WHEN** an oversized message contains a line beginning with heading markers inside a fenced code block
- **THEN** that line is absent from the outline

#### Scenario: Plain oversized message remains readable

- **WHEN** an oversized visible message contains no recognized Markdown headings
- **THEN** the result carries an empty outline plus the normal exact initial slice and continuation
- **AND** the absence of Markdown structure does not make the message unavailable

### Requirement: Optional activity metadata exposes execution facts without hidden reasoning

A read MAY request historical activity metadata for returned assistant messages. When requested, the result SHALL preserve stored relative order between returned visible-text line regions and settled tool calls. A tool activity entry SHALL expose `toolId` as the canonical callable ID from the immutable Run declaration (for example `search_conversations` or `mcp__server__tool`), plus its closed outcome and code-owned safe source attribution already declared by the corresponding tool contract. It SHALL NOT expose the per-invocation tool-call ID. The initial safe-attribution set SHALL be conversation source references and Knowledge Space ID/name/path/range attribution; arbitrary MCP payloads are not admitted by implication.

Activity metadata SHALL exclude reasoning text, reasoning summaries not already ordinary assistant text, tool arguments, unrestricted tool result bodies, provider metadata, model prompts, credentials, and internal diagnostics. It SHALL be labeled historical execution metadata rather than conversation evidence or proof that a tool result caused the answer. If requested activity plus selected source cannot fit the structured bound, the call SHALL return `conversation_limit_exceeded` so the caller can narrow the source or omit activity; it SHALL NOT silently return a partial activity sequence.

#### Scenario: Historical search use is visible

- **WHEN** an assistant message stored visible text, called `search_conversations`, and then stored later visible text
- **THEN** an activity-enabled read orders the first text range, the settled search call with its closed outcome, and the later text range
- **AND** it exposes no raw search input or unrestricted result body

#### Scenario: Reasoning remains excluded

- **WHEN** reasoning parts occur between visible text and tool calls
- **THEN** activity metadata contains no reasoning text or purported explanation derived from it
- **AND** the relative order of visible text and tool entries remains correct

#### Scenario: Tool use is not represented as causation

- **WHEN** an activity-enabled read reports a successful tool call before an assistant conclusion
- **THEN** the result identifies only that the historical call occurred and settled
- **AND** it does not claim that the call caused or supports the conclusion
