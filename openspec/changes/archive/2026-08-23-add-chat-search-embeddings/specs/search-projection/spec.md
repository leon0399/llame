## MODIFIED Requirements

### Requirement: Chunking is deterministic, versioned, and content-hashed

Chunks SHALL be produced by a deterministic, versioned chunker: multi-message windows with a bounded character budget and adjacent-message overlap, carrying role markers and the covered message range (`first/last message id` and timestamps). Windows SHALL split on message boundaries **except** where a single message alone exceeds the budget, in which case that message SHALL be split into budget-sized parts at a text boundary so that **no document ever exceeds the budget**. Each part after the first SHALL carry a bounded anchor — the preceding user message, truncated at a word boundary with an explicit elision marker — so that a fragment of a long message remains interpretable on its own; a split user message carries no anchor, and a message with no preceding user message carries none. A message that fits the budget SHALL chunk exactly as before.

Each chunk SHALL store role-labelled original-cased presentation `content` for snippets and a role-free normalized lexical representation for matching. The content hash SHALL cover both representations, the chunker version, and the covered message range; re-running the chunker over unchanged input MUST produce byte-identical chunks (idempotent, no-op upserts). Changing either representation algorithm, the budget, or the splitting or anchoring rules SHALL require a version bump, and documents of different `chunker_version` SHALL NOT mix within one chat's live projection.

#### Scenario: Unchanged chat is a no-op

- **WHEN** a reindex runs for a chat whose messages have not changed
- **THEN** no projection rows are written (hashes match)

#### Scenario: Edited assistant reply rebuilds affected chunks

- **WHEN** an assistant message's parts are updated after initial persistence
- **THEN** the next reindex replaces the chunks covering that message and removes any obsolete chunks

#### Scenario: Representation version change rebuilds existing chunks

- **WHEN** the chunker version changes
- **THEN** discovery identifies prior-version projection rows as stale and rebuilds them without mixing versions in the chat's live projection

#### Scenario: A single oversized message is split rather than emitted whole

- **WHEN** a chat contains one message several times larger than the chunk budget
- **THEN** it is chunked into multiple documents each within the budget, together covering the message in full with nothing discarded

#### Scenario: A continuation part carries the question it answers

- **WHEN** an oversized assistant message is split into parts
- **THEN** every part after the first begins with a bounded, elision-marked excerpt of the preceding user message

#### Scenario: Messages within budget chunk exactly as before

- **WHEN** every message in a chat is within the budget
- **THEN** the chunks produced are identical to those the previous chunker version produced for the same input

### Requirement: pg_trgm is a declared platform dependency

The schema SHALL create the `pg_trgm` extension via a migration (trusted contrib extension — creatable by the non-superuser owning role, requiring no capability beyond a stock Postgres distribution). The lexical projection's own chunking, indexing, discovery, and matching behavior SHALL depend on no non-stock extension, and an instance with no embedding model configured SHALL index and search exactly as specified here. The `vector` extension is declared and required by the `search-embeddings` capability, which raises the database-image floor for the deployment as a whole: after that capability ships there is one migration chain, so a database lacking `vector` provisions nothing.

#### Scenario: Fresh database provisions cleanly

- **WHEN** migrations run against a fresh database as the non-superuser owner role
- **THEN** the `pg_trgm` extension and the projection schema are created without superuser intervention, `pg_trgm` being a trusted contrib extension that requires no elevated privilege

#### Scenario: Lexical behavior is unchanged with no embeddings configured

- **WHEN** an instance runs with no embedding model configured
- **THEN** every requirement in this capability holds unchanged, and search behaves exactly as it did before the embedding layer existed
