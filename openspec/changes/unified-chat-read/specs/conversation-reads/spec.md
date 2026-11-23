## MODIFIED Requirements

### Requirement: Visible message text is deterministic and message-scoped

The reader MUST use the stored `text` values of eligible text parts, in stored order, joined with exactly `\n\n`. It MUST NOT trim, normalize, or rewrite source text. Each message MUST retain its own attribution and line space.

Only eligible user and immutable assistant messages contribute visible text. Reasoning, tool parts, context items, system/tool rows, and checkpoint rows MUST contribute no bytes. A digest-only host message MUST NOT be an evidence source.

The reader MUST append one placeholder per stored owner `file` part, in stored order, only when the result reaches the text end. Use `[pdf media://<id> <name>]` for `application/pdf`, and `[image media://<id> <name>]` otherwise. Omit the name when absent. Names MUST follow the single-line source-label rules of `media-store`. The reader MUST NOT look up a media object for a placeholder.

Placeholders MUST remain outside visible text, line coordinates, search, excerpts, embeddings, and projection hashes. Each placeholder MUST end with LF. Insert one preceding LF when the last source line lacks a delimiter. Reserve placeholder size within the common rendered-result bound before text fitting. A page with a continuation MUST omit placeholders. Public shared history MUST expose neither files nor their placeholders.

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

#### Scenario: Image placeholders follow the visible text

- **WHEN** an eligible user message stores text part `look at these` and two owner `file` parts
  referencing `media://a` (`shot.png`) and `media://b` (`plan.jpg`), in that order
- **AND** the owner reads it from offset zero
- **THEN** `content` is
  `1: look at these\n[image media://a shot.png]\n[image media://b plan.jpg]\n`
- **AND** `lineCount` is 1 and the result carries no `nextOffset`

#### Scenario: An image-only message reads as placeholders only

- **WHEN** an eligible user message stores one owner `file` part and no text part
- **THEN** a read at offset zero succeeds with zero lines and `content` holding only that file part's
  placeholder line
- **AND** a read at offset 1 returns `invalid_selector`

#### Scenario: A read that stops before the end carries no placeholders

- **WHEN** a read of a message with owner `file` parts returns a slice that includes `nextOffset`
- **THEN** its `content` contains no placeholder line
- **AND** the read starting at that `nextOffset` that reaches the end of the visible text carries
  the placeholder lines after its last numbered line

#### Scenario: Attachments do not move search coordinates

- **WHEN** two messages store identical text parts and only one of them also stores owner `file`
  parts
- **THEN** search projects identical passages with identical `offset` and `limit` for both
- **AND** no placeholder line, `media://` locator, or source label enters the projection, lexical
  data, excerpts, or embeddings

#### Scenario: Placeholder lines need no media lookup

- **WHEN** a stored `file` part of an owner's message names a media id that does not resolve under
  that owner, with `filename` `shot.png`
- **THEN** `read` renders `[image media://<id> shot.png]` for it without looking up any
  media object
- **AND** the result contains no dimensions and no other owner's source label

#### Scenario: Another owner's message with attachments stays not found

- **WHEN** an owner supplies a Chat and sequence of another owner's message that carries owner
  `file` parts
- **THEN** the reader returns `not_found`
- **AND** the observation contains no placeholder line, `media://` locator, or source label

#### Scenario: Public shared history omits attachments

- **WHEN** an anonymous reader paginates a public Chat whose messages carry owner `file` parts
- **THEN** each message DTO carries only its text parts
- **AND** no `file` part, `media://` locator, or placeholder line appears in the page

#### Scenario: A PDF attachment reads as a pdf line

- **WHEN** an eligible user message stores text part `read this` and two owner `file` parts
  referencing `media://a` (`shot.png`, `image/png`) and `media://p` (`paper.pdf`,
  `application/pdf`), in that order
- **AND** the owner reads it from offset zero
- **THEN** `content` is
  `1: read this\n[image media://a shot.png]\n[pdf media://p paper.pdf]\n`
- **AND** the result contains no page count and no PDF bytes

### Requirement: Public message locators use immutable Chat-local sequence

Each committed message MUST have an immutable positive safe-integer sequence local to its Chat. The first value MUST be 1. Later commits MUST allocate consecutive values in insertion order. Checkpoints and digest-only host messages MUST consume sequence values. Rolled-back or colliding inserts MUST consume none.

The datastore MUST enforce uniqueness of `(chat_id, seq)`. The product MUST NOT delete or reorder individual message rows. Whole-Chat deletion MUST remove the namespace through its cascade. An in-place assistant retry MUST retain its sequence. A fork MUST allocate a new namespace from 1 in copied order. Sequence MUST NOT imply time, lineage, cross-Chat order, or authority.

A message locator MUST be `chat://<chatId>/<messageSeq>`. Search MUST append a canonical `L` selector for a message-local line window. It MUST NOT expose internal message UUIDs, part identities, hashes, projection identities, versions, scores, or owner identity as locator fields.

Owner history and public shared DTOs MUST use this same sequence and Chat-local `beforeSeq` cursors. Public pagination MUST retain its text-only allowlist, visibility check, no-store behavior, and empty-identity RLS path. Its policy and serialization MUST exclude checkpoints without renumbering.

Queue parsing MUST validate each triggering sequence as a positive safe integer before history access. It MUST reject zero, negative, fractional, non-finite, and unsafe values.

Navigation MUST identify the nearest currently eligible previous and next messages under owner scope. The reader MUST skip ineligible rows without arithmetic guesses. Checkpoints and digest-only host messages MUST remain unaddressable.

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
- **THEN** it identifies the Chat, Chat-local message sequence, and canonical line-selected message locator
- **AND** the canonical message locator is a valid `read.path` without a part ID, message UUID, prior global sequence, hash, version, or range discriminator

#### Scenario: Public shared history uses the same local cursor

- **WHEN** an anonymous reader paginates a public Chat with `beforeSeq`
- **THEN** message DTOs and cursors use that Chat's one-based local sequence
- **AND** the public path exposes no private Chat, owner-only target mode, reasoning, tool part, or owner identity
- **AND** no `checkpoint` row appears in the page, because the public read policy and pagination both exclude that role

#### Scenario: An anonymous reader of a compacted public Chat sees no checkpoint row

- **WHEN** an anonymous or non-owner reader paginates a public Chat with a checkpoint row
- **THEN** the returned rows and cursors contain no checkpoint
- **AND** the cursor skips that consumed sequence without renumbering

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
- **THEN** the reader returns `not_found`
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

### Requirement: Conversation reads derive authority only from trusted Run identity

Chat reads MUST use only the trusted Run owner identity. Model input MUST contain one `read.path`, not an owner identity or message UUID. Parse the locator and selector strictly before data access. Reject malformed UUIDs, unsupported path components, and non-positive or unsafe message sequences.

Each lookup MUST apply owner RLS, the trusted session-identity guard, and an explicit owner predicate. Empty trusted identity MUST fail closed. Missing, deleted, foreign, shared-only, revised, and mutable sources MUST return the same `not_found` result. No rejected lookup can disclose title, status, Workspace, timestamp, sequence, or content.

The reader MUST admit user messages and completed or legacy-immutable assistant messages that no Regenerate replaces. It MUST exclude assistant messages with usage status other than `completed`, revised replies, checkpoints, and digest-only host messages. A public share or shared fork MUST grant no access to its source. Archived owned Chats MUST remain directly readable.

#### Scenario: Direct owner message read succeeds

- **WHEN** the trusted Run owner gives a valid owned Chat and an eligible message sequence
- **THEN** the reader returns the visible text of that message from the requested line offset
- **AND** the reader accepts no owner identity or message UUID from model input

#### Scenario: Another owner's sequence fails closed

- **WHEN** an owner gives a well-formed Chat and sequence pair that resolves only under another owner or under a public share
- **THEN** the reader returns `not_found`
- **AND** the observation reveals no foreign title, role, timestamp, sequence, content, or existence

#### Scenario: Retryable assistant source is unavailable

- **WHEN** a selector identifies an assistant row whose usage records a status other than `completed`
- **THEN** the reader returns `not_found`
- **AND** it does not show changeable bytes as canonical history

#### Scenario: A revised assistant source stays unavailable

- **WHEN** a completed Regenerate replaces a completed assistant reply
- **THEN** the reader returns `not_found`
- **AND** the adjacent eligible sequences skip that row

#### Scenario: Malformed input never reaches source resolution

- **WHEN** the input has a malformed locator, an unsafe sequence, an invalid selector, or unknown properties
- **THEN** strict tool validation rejects it before any source query
- **AND** the failure is not a `not_found` observation

### Requirement: Conversation reads use Knowledge-style logical-line ranges

A message read MUST accept `L` members, bare line members, comma lists, and `raw` over the visible-text source. LF MUST delimit logical lines. CRLF MUST form one delimiter. Lone CR MUST remain source text. Blank lines MUST count. A terminal delimiter MUST NOT add a phantom line.

Selected windows MUST be exact. The reader MUST NOT add filesystem context lines or Markdown processors. Multiple ranges MUST use the shared sort and merge rules without context expansion. Numbered output MUST prefix each source line with its one-based number. Preserve source delimiters and an unterminated last line. `raw` MUST omit generated prefixes without changing eligible parts or line coordinates.

Each success MUST carry the common read envelope, Chat and message attribution, role, timestamp, source ranges, eligible neighbors, and the closed untrusted-history notice. It MUST use plain-text model rendering under `tool-result-rendering`. The notice MUST identify historical content as untrusted and potentially stale. It MUST deny that content authority over instructions, tools, permissions, or owner identity.

One call MUST obey the common 16,000-code-unit rendered-result bound and 2,000-line ceiling. It MUST fit whole source lines and preserve exact continuation coordinates. A bound-limited page MUST name the first omitted source line in a readable continuation locator. A finite completed window MUST NOT claim truncation solely because later source lines exist.

If the first source line cannot fit, return `representation_too_large`. An out-of-range nonempty selection MUST return `invalid_selector`. An empty message at its initial position MUST succeed with zero source lines and any attachment placeholders. Generic truncation MUST NOT clip a successful page. Read-only status metadata MUST count toward the same bound.

#### Scenario: Fitting message read is complete

- **WHEN** the requested message range fits every line and output bound
- **THEN** the reader returns each selected source line with its one-based prefix and exact source delimiters
- **AND** it omits `nextOffset` and `cutReason` when no current line remains

#### Scenario: Long message continues explicitly

- **WHEN** an omitted or explicit range reaches a server line/output bound after at least one complete line
- **THEN** the result contains the largest fitting whole-line prefix and `nextOffset` for the first omitted line
- **AND** it carries the applicable cut reason without a generic truncation marker

#### Scenario: Explicit limit completes before message end

- **WHEN** a finite line selector completes within the result bound while later message lines exist
- **THEN** the result returns that exact window without a bound-cut notice
- **AND** its source metadata can still identify the next eligible message or later source lines

#### Scenario: Search passage expands through read

- **WHEN** search supplies a canonical message locator with its `L` window
- **THEN** read returns that complete message-local window, subject only to whole-line result bounds
- **AND** a cropped discovery excerpt does not imply complete source text

#### Scenario: Persistable read keeps historical-data framing

- **WHEN** a successful read returns prior-conversation content
- **THEN** its structured payload includes the closed untrusted-history notice
- **AND** later persistence/replay does not rely solely on the original tool description for that framing

#### Scenario: One oversized line fails closed

- **WHEN** the first selected logical line cannot fit within the structured result bound
- **THEN** the tool returns `representation_too_large`
- **AND** it does not introduce a character-offset selector or irrecoverably clip the line

#### Scenario: Empty message at zero succeeds

- **WHEN** an eligible message has empty visible text and the caller reads offset zero
- **THEN** the result succeeds with zero lines and empty content when the message has no owner
  `file` part
- **AND** an offset beyond zero returns `invalid_selector`

#### Scenario: Placeholder lines share the structured-result bound

- **WHEN** a message has attachment placeholders and enough source text to reach the rendered-result bound
- **THEN** the reader reserves placeholder space before it fits whole source lines
- **AND** a cut page carries its exact continuation without placeholders
- **AND** only the read that reaches the end of the visible text, which omits `nextOffset`, carries
  the placeholder lines
- **AND** every complete result, placeholder lines included, is at most 16,000 code units

### Requirement: Owner-facing message links use the Chat-local sequence locator

The owner interface MUST use `/chat/<chatId>#msg-<messageSeq>` for a message target. A hash-targeted initial load MUST use strict positive-safe-integer `targetSeq` on the owner history API. `targetSeq` and `beforeSeq` MUST be mutually exclusive. Reject malformed, zero, negative, fractional, unsafe, or unknown query values before repository access.

The server MUST verify the exact target under current owner scope. It MUST then return the normal fixed-size history window that ends at that target. Missing and foreign targets MUST share one closed not-found path. A target beyond the ordinary initial page MUST remain reachable.

Rendered messages MUST expose stable `msg-<messageSeq>` anchors without internal UUIDs or former database-wide sequences. This change MUST NOT add a copy-link control. A URL MUST remain navigation, not Chat-read authority. Target-mode cache identity MUST remain separate from the newest-window identity.

#### Scenario: Copied owner link reaches its Chat-local message

- **WHEN** an owner opens a copied canonical link to an eligible message outside the initially loaded page
- **THEN** `targetSeq` returns the owner-authorized history window ending at that exact Chat-local sequence and the Chat scrolls to `msg-<messageSeq>`
- **AND** the visible target is the same message addressed by `read`

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

## ADDED Requirements

### Requirement: Chat collection reads use owner-scoped shared rows

`read("chat://")` MUST list non-archived owned Chats, including the current Chat and untitled Chats. Each row MUST use the shared Chat row. The listing MUST order pinned Chats by owner pin rank, then other Chats by descending activity, with Chat-id ties. It MUST return at most 20 rows by default. Single line-index selectors MUST page that order. Omitted rows MUST have a readable continuation.

#### Scenario: Collection includes untitled and current Chats

- **WHEN** the owner has an untitled Chat, the current Chat, and an archived Chat
- **THEN** the collection includes the first two and omits the archived Chat
- **AND** an untitled row has an explicit untitled label

#### Scenario: Collection cannot reveal foreign Chats

- **WHEN** another owner has a recent pinned Chat
- **THEN** the collection omits its title, locator, Workspace, status, and excerpts

#### Scenario: A collection page advances

- **WHEN** more rows fit the requested order than one bounded page
- **THEN** the result ends at a whole row and provides the next collection locator

### Requirement: Shared Chat rows carry address and Workspace affinity

A shared Chat row MUST carry a canonical Chat locator, title, absolute activity date, message count, Workspace affinity, and bounded excerpts. Affinity MUST be the stored canonical `machine://` root or `unbound`. The reader MUST use the source Chat's stored Machine identity for an absolute root. It MUST NOT probe the Machine or substitute a Project or Repository name. Dates and counts MUST describe the row's resolution time.

#### Scenario: Worktrees remain distinguishable

- **WHEN** two Chats bind different worktree roots of the same Repository
- **THEN** their rows show distinct canonical Workspace locators

#### Scenario: An unbound Chat has explicit affinity

- **WHEN** a Chat has no Workspace binding
- **THEN** its row shows `unbound`

#### Scenario: A stored remote binding requires no Machine contact

- **WHEN** a row names a Workspace on an unreachable Machine
- **THEN** the read returns the stored affinity without a filesystem or daemon request

### Requirement: Shared Chat rows carry two bounded visible excerpts

Rows MUST use the first stored user message and the latest evidence-eligible message as excerpt sources. Each excerpt MUST contain at most 100 Unicode code points after whitespace collapse. The total MUST NOT exceed 200. The row MUST label the sources, omit empty excerpts, and emit one excerpt when both sources have the same sequence. It MUST exclude reasoning, tool parts, context items, and media bytes.

#### Scenario: Latest assistant text can appear

- **WHEN** the first user message and latest completed assistant reply differ
- **THEN** the row shows up to 100 code points from each visible-text source

#### Scenario: A one-message Chat has one excerpt

- **WHEN** the first user message is also the latest eligible message
- **THEN** the row shows one excerpt without duplicate text

#### Scenario: Unicode excerpt bounds preserve characters

- **WHEN** an excerpt source contains supplementary Unicode characters
- **THEN** the row cuts on code-point boundaries within its 100-code-point limit

#### Scenario: A private part never becomes a preview

- **WHEN** a latest reply contains reasoning and tool results but no visible text
- **THEN** the latest excerpt is absent
- **AND** the row substitutes no private part

### Requirement: A Chat index uses immutable message sequence windows

`read("chat://<id>")` MUST select the newest 50 eligible messages and display its fitting newest rows in ascending sequence order. Each row MUST carry sequence, role, timestamp, message locator, and a visible-text preview of at most 200 code points. The index MUST skip ineligible rows without renumbering. One `M` member MUST select actual committed sequence values. A finite range MUST NOT extend to replace skipped rows.

#### Scenario: Index defaults to recent messages

- **WHEN** an owned Chat has more than 50 eligible messages
- **THEN** the index shows the newest 50 in chronological order when they fit the output bound

#### Scenario: Sequence gaps stay gaps

- **WHEN** sequences 20 and 22 are eligible and sequence 21 is a checkpoint
- **THEN** `:M20-22` shows sequences 20 and 22 only

#### Scenario: A count member counts sequence positions

- **WHEN** sequences 5 and 7 are eligible and sequence 6 is not
- **THEN** `:M5+3` returns sequences 5 and 7, not three eligible rows

#### Scenario: A tail member uses committed positions

- **WHEN** the largest committed sequence is 100 and sequence 99 is ineligible
- **THEN** `:-M2` selects positions 99 and 100 and returns only eligible position 100

#### Scenario: A bare range gets an M hint

- **WHEN** a Chat index receives `:5-10`
- **THEN** the read fails `invalid_selector` with a hint to use `M`

### Requirement: Chat index pages respect common output bounds

A message-index page MUST contain at most 50 eligible rows within the common rendered bound. An explicit `M` range MUST fit rows from its lowest selected sequence. Its continuation MUST address the first unserved sequence through the requested end. A default page MUST instead keep its newest fitting rows and provide its earlier-history locator. Indexes MUST keep whole rows. If the required first row cannot fit, return `representation_too_large`.

#### Scenario: An explicit index window continues

- **WHEN** an explicit `M` window contains more than 50 eligible messages
- **THEN** the first page starts at the lowest selected sequence and names the next unserved window

#### Scenario: An empty sequence window succeeds

- **WHEN** no eligible message occupies the selected committed interval
- **THEN** the index returns an empty page without fabricated neighbors

#### Scenario: An oversized index row fails closed

- **WHEN** the first requested row cannot fit the common bound
- **THEN** the result is `representation_too_large` without clipped text or continuation

### Requirement: Default Chat indexes page toward earlier history

An unselected Chat index MUST keep the newest whole rows when its default page exceeds the output bound. If earlier eligible messages exist, it MUST provide `chat://<id>:M1-<oldest-shown-sequence-minus-one>`. This locator MUST select only earlier history. No earlier eligible message MUST mean no earlier-history locator. An explicit finite `M` page MUST retain its separate forward-continuation rule.

#### Scenario: An oversized default page keeps the newest rows

- **WHEN** the newest 50 rows exceed the rendered bound
- **THEN** the default page drops its oldest rows and retains its newest whole rows
- **AND** its earlier-history locator ends before its oldest shown sequence

#### Scenario: An explicit range still moves forward

- **WHEN** an explicit `M20-100` page ends before sequence 70
- **THEN** its continuation selects `M70-100`, not earlier history

### Requirement: Chat reads report current durable Run status only on demand

Every Chat collection row and addressed Chat or message read MUST annotate the current non-terminal Run status, or `idle` when none exists. Use `queued`, `running_model`, `awaiting_jobs`, or `awaiting_quota` as stored. The annotation MUST describe one owner-scoped point-in-time read. It MUST NOT expose Run ids or diagnostics. Shared Chat rows and recency-digest items MUST contain no Run-status annotation.

#### Scenario: A live Chat is recognizable

- **WHEN** an owned Chat has a `running_model` Run
- **THEN** its collection row, message index, and message read report `running_model`

#### Scenario: A waiting Run differs from active execution

- **WHEN** the current Run of a Chat has status `awaiting_quota`
- **THEN** read reports `awaiting_quota`, not `running_model` or `idle`

#### Scenario: A terminal Run leaves the Chat idle

- **WHEN** the Chat has only completed, failed, cancelled, or expired Runs
- **THEN** read reports `idle` without exposing the last failure

#### Scenario: Run activity never changes the digest

- **WHEN** only the source Chat Run status changes
- **THEN** digest text and comparison metadata remain unchanged

### Requirement: Chat locators do not admit mutations or implicit imports

`edit` and `write` MUST refuse admitted Chat locators with `unsupported_operation`, without effects or Run admission. A registered Chat reader MUST NOT make `@chat://` a prompt import. Chat locators MUST grant no file access, Machine access, share authority, or alias. An unsupported selector MUST fail before a source lookup.

#### Scenario: A Chat write is still unavailable

- **WHEN** an admitted `write` targets an owned Chat locator
- **THEN** the call returns `unsupported_operation` and creates no message or Run

#### Scenario: Chat registration does not expand imports

- **WHEN** an owner message contains `@chat://<id>/1`
- **THEN** prompt preparation treats it as prose and performs no implicit Chat read

#### Scenario: Raw keeps the visible boundary

- **WHEN** an owner reads a message with `:raw`
- **THEN** the result omits line prefixes but exposes no reasoning, tool part, or context item
