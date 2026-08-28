## MODIFIED Requirements

### Requirement: Conversation read uses the existing immutable read-only tool loop

The code-owned tool inventory SHALL include `conversation_read` in addition to `search_conversations`, `knowledge_search`, and `knowledge_read`. It SHALL declare `read_only`, require its own exact `tools.allowed` entry, and participate in the existing declaration admission, immutable Run snapshot, execution rebinding, timeout, cooperative cancellation, settlement, persistence, replay, compaction, neutralization, and generic browser-rendering lifecycle. Owner authority SHALL come only from trusted Run context, never from model arguments or a message locator.

The conversation reader SHALL enforce the `conversation-reads` bounds of 2,000 logical lines and 15,000 JavaScript UTF-16 code units before generic result truncation. A read whose first selected source line cannot fit SHALL return `conversation_limit_exceeded`. Bounded pages SHALL preserve exact `nextOffset` and cut-reason metadata, and generic truncation SHALL NOT clip numbered source content.

Structured Chat/message sequence attribution, role/timestamp, numbered content, neighboring eligible sequences, continuation metadata, and the closed untrusted-history notice SHALL persist and render as authored through the ordinary tool UI. Replay SHALL NOT rehydrate newer message content, synthesize hashes/UUIDs/versions/part identities, remove line prefixes/notices, or normalize historical result shapes. Adding or changing the code-owned declaration or Chat-local sequence semantics SHALL use a coordinated API/worker/data cutover: quiesce new Run acceptance, drain Runs bound to the prior declaration and sequence interpretation, migrate durable sequence boundaries, deploy matching executors/declarations, then resume; rollback SHALL restore the matching prior binaries and data snapshot rather than mix locator interpretations.

A persisted conversation-read observation SHALL follow the destination Chat's existing retention and deletion lifecycle. Product behavior SHALL NOT delete an individual source message. Deleting or later losing access to the source Chat SHALL make a fresh read return `conversation_source_not_found` but SHALL NOT redact or rewrite text already recorded in another owner-visible Chat. Deleting the destination Chat SHALL remove its messages, Runs, and Run events through the existing cascade lifecycle.

Because the global-to-Chat-local sequence rewrite is a pre-merge alpha hard cutover, deployment SHALL preflight persisted assistant parts and Run events before changing sequence values. If it finds an experimental canonical `search_conversations` result or `conversation_read` input/result authored under the prior global interpretation, the cutover SHALL abort before mutation. It SHALL NOT rewrite the historical observation, accept its global value as an alias, or guess between colliding locator namespaces. The unsupported experimental Chat or database must be removed/reset as a whole before retrying the cutover.

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

#### Scenario: Experimental global locator blocks the alpha cutover

- **WHEN** migration preflight finds a persisted canonical search/read observation authored with the unmerged global sequence interpretation
- **THEN** the cutover fails before rewriting any message or compaction sequence
- **AND** it neither mutates that observation nor installs a global-sequence alias path

#### Scenario: Source deletion does not rewrite another Chat's observation

- **WHEN** a persisted conversation-read result in one owner-visible Chat quotes a source Chat later deleted or unavailable
- **THEN** the historical result remains recorded while a fresh call returns `conversation_source_not_found`
- **AND** deleting the destination Chat removes that observation under the existing Chat/Run cascade lifecycle

#### Scenario: Generic tool UI remains the rendering floor

- **WHEN** a live or historical `conversation_read` result reaches the browser
- **THEN** the existing structured tool renderer displays its input, lifecycle state, result, or closed error
- **AND** no specialized source card, outline, activity timeline, or conversation-only renderer is required

#### Scenario: Conversation-read declaration cutover drains prior Runs

- **WHEN** deployment changes code-owned conversation declarations or the interpretation of message sequence fields
- **THEN** it stops accepting new Runs and drains Runs and queue payloads bound to the prior interpretation before migrating sequence boundaries
- **AND** acceptance resumes only after every API and worker exposes the matching declaration, executor, and Chat-local sequence semantics
