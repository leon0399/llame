## ADDED Requirements

### Requirement: Conversation read uses the existing immutable read-only tool loop

The code-owned tool inventory SHALL include `conversation_read` in addition to `search_conversations`, `knowledge_search`, and `knowledge_read`. It SHALL declare `read_only`, require its own exact `tools.allowed` entry, and participate in the existing declaration admission, immutable Run snapshot, execution rebinding, timeout, cooperative cancellation, settlement, persistence, replay, compaction, neutralization, and generic browser-rendering lifecycle. Owner authority SHALL come only from trusted Run context, never from model arguments or a message locator.

The conversation reader SHALL enforce the `conversation-reads` bounds of 2,000 logical lines and 15,000 JavaScript UTF-16 code units before generic result truncation. A read whose first selected source line cannot fit SHALL return `conversation_limit_exceeded`. Bounded pages SHALL preserve exact `nextOffset` and cut-reason metadata, and generic truncation SHALL NOT clip numbered source content.

Structured Chat/message sequence attribution, role/timestamp, numbered content, neighboring eligible sequences, continuation metadata, and the closed untrusted-history notice SHALL persist and render as authored through the ordinary tool UI. Replay SHALL NOT rehydrate newer message content, synthesize hashes/UUIDs/versions/part identities, remove line prefixes/notices, or normalize historical result shapes. Adding or changing the code-owned declaration SHALL use the coordinated API/worker cutover: quiesce new Run acceptance, drain Runs bound to the prior declaration, deploy matching executors/declarations, then resume; rollback uses the reverse boundary.

A persisted conversation-read observation SHALL follow the destination Chat's existing retention and deletion lifecycle. Deleting or later losing access to the source message SHALL make a fresh read return `conversation_source_not_found` but SHALL NOT redact or rewrite text already recorded in another owner-visible Chat. Deleting the destination Chat SHALL remove its messages, Runs, and Run events through the existing cascade lifecycle.

#### Scenario: Conversation reader is not allowlisted

- **WHEN** `conversation_read` is registered but absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly accepted Run

#### Scenario: Allowlisted reader is bound immutably

- **WHEN** the exact reader ID is eligible for a newly accepted Run
- **THEN** that Run snapshots its exact declaration and requires the matching code-owned executor
- **AND** no Chat/sequence argument supplies owner authority

#### Scenario: Bounded continuation survives persistence

- **WHEN** a reader success returns numbered content with `nextOffset` and a cut reason
- **THEN** live events, assistant-message settlement, browser reload, and full-payload replay preserve the exact result
- **AND** the persisted observation is not replaced by a generic truncation preview

#### Scenario: Historical read is not rehydrated

- **WHEN** message content, sequence navigation, or line-rendering code changes after a read result was persisted
- **THEN** reload and replay preserve the bounded historical observation as authored
- **AND** they do not reread the source or rewrite its coordinates/content

#### Scenario: Source deletion does not rewrite another Chat's observation

- **WHEN** a persisted conversation-read result in one owner-visible Chat quotes a source later deleted or unavailable
- **THEN** the historical result remains recorded while a fresh call returns `conversation_source_not_found`
- **AND** deleting the destination Chat removes that observation under the existing Chat/Run cascade lifecycle

#### Scenario: Generic tool UI remains the rendering floor

- **WHEN** a live or historical `conversation_read` result reaches the browser
- **THEN** the existing structured tool renderer displays its input, lifecycle state, result, or closed error
- **AND** no specialized source card, outline, activity timeline, or conversation-only renderer is required

#### Scenario: Conversation-read declaration cutover drains prior Runs

- **WHEN** deployment adds or changes the code-owned conversation reader declaration
- **THEN** it stops accepting new Runs and drains Runs bound to the prior tool set before replacing API or worker binaries
- **AND** acceptance resumes only after every executing process exposes the matching declaration and executor
