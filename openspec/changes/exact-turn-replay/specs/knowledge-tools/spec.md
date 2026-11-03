## MODIFIED Requirements

### Requirement: Retrieval persists safe response-time attribution

Each new successful search passage MUST include five fields. These are the
logical Knowledge Space identifier, the display name at response time, and the
exact Knowledge-relative path. The other two are the `kb://` locator with its
one-based line range, and a bounded excerpt. `kb://`
read, list, edit, and write results follow the result contract of the native file
tools and carry the same Space identifier and display name. These fields describe
what that live call observed. They MUST NOT claim that a path, a display name, an
authorization binding, coordinates, or content stays the same. New results MUST
expose no content hash, expected hash, revision, configured root, or resolved host
path.

The fields MUST stay complete in the persisted tool-result part, in the live event
stream, and in browser reconstruction. Knowledge success results preflight below
the live-result cap, so nothing cuts them. Later model replay MUST carry the result as the live
loop sent it, under `turn-replay`. A successful search that records
`complete: false` keeps that field in each later replay.

Historical persisted Knowledge observations MUST stay immutable. A result written
before this change can keep its original `contentHash`, matching-line, and snippet
fields. Replay and browser reconstruction MUST keep those fields as recorded. They
MUST NOT add new range fields or remove historical attribution. Historical
`knowledge_read` observations MUST render as recorded. The tool no longer exists,
and a Run whose snapshot names it fails closed before the provider request.

The persisted observation MUST include the bounded excerpt or the returned
Markdown in the PostgreSQL stores of Run events and assistant message parts. It
MUST follow the Run and Chat retention and deletion lifecycle of those stores.
This execution history MUST NOT become a canonical Knowledge content projection,
an index, a source store, or another read authority. The system MUST add no
separate Knowledge-content persistence, and each later retrieval MUST read the
live files again.

Attribution MUST exclude configured roots, resolved child paths, hosted owner ids,
credentials, worker identity, and raw filesystem diagnostics. The structured
tool-result UI MUST show the display name at response time, the stable
identifier, the Knowledge-relative path, and the locator. Thus two spaces with
the same name stay different. `kb://` results render through the renderer of the
`read` tool, which shows the same fields from the native envelope. The packaged
tool description MUST tell the model to cite the space and the path of a note that
it uses. The system MUST NOT change arbitrary provider text to make a citation.

#### Scenario: Browser reload retains attribution

- **WHEN** a Chat uses a new successful Knowledge passage and the browser reloads
- **THEN** the rebuilt result keeps the same space identifier, response-time name, path, locator, and recorded excerpt
- **AND** it requires no content hash

#### Scenario: Historical hash-bearing result remains historical

- **WHEN** a Chat reloads a Knowledge result persisted before this change
- **THEN** its original hash, matching line, snippet, or complete content stays as recorded
- **AND** replay does not rewrite it into the new result shape

#### Scenario: Later file change does not alter history

- **WHEN** a space name or a file changes after the system persisted a successful tool result
- **THEN** the persisted result keeps its original response-time name, path, locator, and excerpt
- **AND** a later tool call can return different metadata, ranges, or bytes

#### Scenario: Browser Chat exposes the note citation

- **WHEN** a browser Chat finds and uses a live note from one of several spaces
- **THEN** the structured result visibly cites the response-time space identity and the Knowledge-relative path
- **AND** the tool description tells the model to cite both in its answer, with no configured or resolved host path

#### Scenario: Payload-cleared replay preserves incomplete search honesty

- **WHEN** a successful search with `complete: false` replays on a later turn
- **THEN** the replay carries `complete: false` as the live loop sent it
- **AND** no replay clears the payload, so the call cannot look like a complete search
