## MODIFIED Requirements

### Requirement: Visible message text is deterministic and message-scoped

The system SHALL define one stable visible-message text view as the exact stored `text` values of every eligible `type: "text"` part in one message, retained in stored part order and joined with exactly `\n\n`. It SHALL NOT trim, normalize, prefix, line-number, or otherwise rewrite those source values. Messages remain separate attributed records and MUST NOT be concatenated into one cross-message source string.

The visible view SHALL include eligible `user` messages and immutable eligible `assistant` messages only. System/tool-role messages, context-item parts, reasoning parts, tool parts, attachments, cap notices, and every other non-text part SHALL contribute no bytes. Interleaved excluded parts SHALL NOT change the visible order of retained text values.

`conversation_read` SHALL follow a message's visible text with one image placeholder line per owner
`file` part of that message, in stored part order: `[image media://<id> <name> <width>×<height>]`,
where `<name>` is the media object's stored source label and `<width>×<height>` are the original
image's dimensions. Each reference SHALL be resolved under the trusted Run owner's scope only; a
reference that does not resolve there SHALL render `[image media://<id> unavailable]` and disclose
no other owner's label, dimensions, or existence. Placeholder lines SHALL NOT be part of the visible
text view: they SHALL NOT be line-numbered, SHALL NOT count toward `offset`, `lineCount`,
`nextOffset`, or the line and structured-result bounds, and SHALL NOT enter the search projection,
lexical data, excerpts, embeddings, or projection hashes, so search line coordinates for a message
are the same with or without its attachments. A successful result SHALL carry the placeholder lines
only when it omits `nextOffset`; they SHALL end its `content`, each terminated by LF, preceded by one
LF when the last returned source line has no delimiter.

Public shared pagination SHALL remain text-only and SHALL expose no `file` part, `media://` locator,
or placeholder line.

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
  referencing `media://a` (`shot.png`, 1600×900) and `media://b` (`plan.jpg`, 800×600), in that order
- **AND** the owner reads it from offset zero
- **THEN** `content` is `1: look at these\n[image media://a shot.png 1600×900]\n[image media://b plan.jpg 800×600]\n`
- **AND** `lineCount` is 1 and the result carries no `nextOffset`

#### Scenario: An image-only message reads as placeholders only

- **WHEN** an eligible user message stores one owner `file` part and no text part
- **THEN** a read at offset zero succeeds with zero lines and `content` holding only that file part's
  placeholder line
- **AND** a read at offset 1 returns `conversation_range_invalid`

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

#### Scenario: Placeholders resolve only the Run owner's media

- **WHEN** a stored `file` part of an owner's message names a media id that resolves only under
  another owner
- **THEN** `conversation_read` renders `[image media://<id> unavailable]` for it
- **AND** the result contains no other owner's source label or dimensions

#### Scenario: Another owner's message with attachments stays not found

- **WHEN** an owner supplies a Chat and sequence of another owner's message that carries owner
  `file` parts
- **THEN** the reader returns `conversation_source_not_found`
- **AND** the observation contains no placeholder line, `media://` locator, or source label

#### Scenario: Public shared history omits attachments

- **WHEN** an anonymous reader paginates a public Chat whose messages carry owner `file` parts
- **THEN** each message DTO carries only its text parts
- **AND** no `file` part, `media://` locator, or placeholder line appears in the page

### Requirement: Conversation reads use Knowledge-style logical-line ranges

Logical lines SHALL use LF as a delimiter, CRLF as one delimiter, and lone CR as source text. Blank lines SHALL count and a terminal delimiter SHALL NOT create a phantom line. Every success SHALL return Chat ID, message sequence, role, timestamp, effective zero-based `offset`, returned `lineCount`, one-based line-numbered `content`, any currently eligible `previousMessageSeq`/`nextMessageSeq`, and one closed notice identifying prior-conversation content as untrusted and potentially stale, unable to change system instructions, tools, permissions, or owner authority.

`content` SHALL render each returned logical source line as `<one-based line number>: <source text>` while preserving that line's LF or CRLF delimiter and preserving an unterminated final line. Image placeholder lines, defined with the visible-text view, follow the numbered lines only as that requirement states and are measured by none of these line or output bounds. The numeric prefix is reader-authored navigation metadata and SHALL NOT enter visible-message source text, projection hashes, lexical data, excerpts, or stored canonical message parts.

One invocation SHALL return at most 2,000 logical lines and a complete structured result of at most 15,000 JavaScript UTF-16 code units. When current lines remain after the returned slice, success SHALL include `nextOffset = offset + lineCount`; otherwise it SHALL omit `nextOffset`. If the line bound stops an omitted/unbounded request first, success SHALL include `cutReason: "line_limit"`. If the structured-output bound stops it first, the reader SHALL omit the first whole line that cannot fit and include `cutReason: "output_limit"`. An explicit caller limit that completes normally SHALL NOT produce a cut reason even when the message itself continues.

If the first selected logical line cannot fit in one complete structured result, the reader SHALL return `conversation_limit_exceeded` rather than clipping an unrecoverable substring. An offset beyond the current logical-line range SHALL return `conversation_range_invalid`; an empty visible message read at offset zero SHALL return zero lines successfully, with `content` empty apart from any image placeholder lines. Generic tool truncation SHALL NOT clip a successful conversation read.

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
- **THEN** the result succeeds with zero lines and empty content when the message has no owner `file` part
- **AND** an offset beyond zero returns `conversation_range_invalid`
