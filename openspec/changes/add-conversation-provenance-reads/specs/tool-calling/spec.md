## ADDED Requirements

### Requirement: Conversation reads use the existing immutable read-only tool loop

The code-owned tool inventory SHALL include `read_conversation_range` in addition to `search_conversations`, `knowledge_search`, and `knowledge_read`. It SHALL declare `read_only`, require its own exact `tools.allowed` entry, and participate in the existing declaration admission, immutable Run snapshot, execution rebinding, timeout, cooperative cancellation, settlement, persistence, replay, compaction, neutralization, and browser-rendering lifecycle. Its owner authority SHALL come only from trusted Run context, never from model arguments or a source reference.

The conversation reader SHALL enforce the `conversation-reads` bounds of 20 messages, 2,000 lines, 15,000 JavaScript UTF-16 code units, and five surrounding messages per side before generic result truncation. A direct/line read whose first source line cannot fit SHALL return `conversation_limit_exceeded`; a server-issued bounded text-offset source MAY remain readable inside that line. Bounded pages SHALL preserve exact continuation metadata, and oversized direct whole-message reads SHALL preserve the defined outline without clipping canonical source. A bounded page with remaining requested source SHALL persist its exact `complete: false` and navigation metadata. Whenever replay later clears that payload—including ordinary bounded next-turn projection or compaction into the observation ledger—the payload-cleared observation SHALL carry outcome `incomplete`, not `success`. A complete page remains `success`; errors retain their closed error outcome.

Structured conversation source references, exact visible-text slices, outlines, and requested safe activity metadata SHALL persist and render as authored. Replay SHALL NOT rehydrate newer message content, rerun a Markdown parser, synthesize hashes or part identities, or normalize historical result shapes. Adding or changing the code-owned declaration SHALL use the repository's coordinated API/worker cutover: quiesce new Run acceptance, drain Runs bound to the prior declaration, deploy matching executors and declarations, then resume; rollback uses the reverse boundary.

A persisted conversation-read observation SHALL follow the destination Chat's existing retention and deletion lifecycle. Deleting or later losing access to the source message SHALL make a fresh read return `conversation_source_not_found` but SHALL NOT redact or rewrite text already recorded in another owner-visible Chat. Deleting the destination Chat SHALL remove its messages, Runs, and Run events through the existing cascade lifecycle.

#### Scenario: Conversation reader is not allowlisted

- **WHEN** `read_conversation_range` is registered but absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly accepted Run

#### Scenario: Allowlisted reader is bound immutably

- **WHEN** the exact reader ID is eligible for a newly accepted Run
- **THEN** that Run snapshots its exact declaration and requires the matching code-owned executor
- **AND** no source reference or model argument supplies owner authority

#### Scenario: Bounded continuation survives persistence

- **WHEN** a reader success returns exact source with `complete: false` and a next selector
- **THEN** live events, assistant-message settlement, browser reload, and full-payload replay preserve the exact result
- **AND** payload-cleared replay reports `incomplete` rather than complete success

#### Scenario: Historical read is not rehydrated

- **WHEN** message content, parsing code, or visible-text implementation changes after a read result was persisted
- **THEN** reload and replay preserve the bounded historical observation as authored
- **AND** they do not reread messages or rewrite its coordinates and content

#### Scenario: Source deletion does not rewrite another Chat's observation

- **WHEN** a persisted read result in one owner-visible Chat quotes a source that is later deleted or becomes unavailable
- **THEN** the historical result remains recorded as authored while a fresh read returns `conversation_source_not_found`
- **AND** deleting the destination Chat removes that observation under the existing Chat/Run cascade lifecycle

#### Scenario: Conversation-read declaration cutover drains prior Runs

- **WHEN** deployment adds or changes the code-owned conversation reader declaration
- **THEN** it stops accepting new Runs and drains Runs bound to the prior tool set before replacing API or worker binaries
- **AND** acceptance resumes only after every executing process exposes the matching declaration and executor
