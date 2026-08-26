## ADDED Requirements

### Requirement: Conversation reads use the existing immutable read-only tool loop

The code-owned tool inventory SHALL include `read_conversation_range` in addition to `search_conversations`, `knowledge_search`, and `knowledge_read`. It SHALL declare `read_only`, require its own exact `tools.allowed` entry, and participate in the existing declaration admission, immutable Run snapshot, execution rebinding, timeout, cooperative cancellation, settlement, persistence, replay, compaction, neutralization, and browser-rendering lifecycle. Its owner authority SHALL come only from trusted Run context, never from model arguments or a source reference.

The conversation reader SHALL preflight successful results below its tool-specific bound before generic result truncation. A bounded page with remaining requested source SHALL persist its exact `complete: false` and navigation metadata. Whenever replay later clears that payload—including ordinary bounded next-turn projection or compaction into the observation ledger—the payload-cleared observation SHALL carry outcome `incomplete`, not `success`. A complete page remains `success`; errors retain their closed error outcome.

Structured conversation source references, exact visible-text slices, outlines, and requested safe activity metadata SHALL persist and render as authored. Replay SHALL NOT rehydrate newer message content, rerun a Markdown parser, synthesize hashes or part identities, or normalize historical result shapes. Adding or changing the code-owned declaration SHALL use the repository's coordinated API/worker cutover: quiesce new Run acceptance, drain Runs bound to the prior declaration, deploy matching executors and declarations, then resume; rollback uses the reverse boundary.

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

#### Scenario: Conversation-read declaration cutover drains prior Runs

- **WHEN** deployment adds or changes the code-owned conversation reader declaration
- **THEN** it stops accepting new Runs and drains Runs bound to the prior tool set before replacing API or worker binaries
- **AND** acceptance resumes only after every executing process exposes the matching declaration and executor
