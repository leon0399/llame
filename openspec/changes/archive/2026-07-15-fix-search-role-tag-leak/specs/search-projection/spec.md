## MODIFIED Requirements

### Requirement: Chunking is deterministic, versioned, and content-hashed

Chunks SHALL be produced by a deterministic, versioned chunker: multi-message windows split on message boundaries with a bounded character budget and adjacent-message overlap, carrying role markers and the covered message range (`first/last message id` and timestamps). Each chunk SHALL store role-labelled original-cased presentation `content` for snippets and a role-free normalized lexical representation for matching. The content hash SHALL cover both representations, the chunker version, and the covered message range; re-running the chunker over unchanged input MUST produce byte-identical chunks (idempotent, no-op upserts). Changing either representation algorithm SHALL require a version bump, and documents of different `chunker_version` SHALL NOT mix within one chat's live projection.

#### Scenario: Unchanged chat is a no-op

- **WHEN** a reindex runs for a chat whose messages have not changed
- **THEN** no projection rows are written (hashes match)

#### Scenario: Edited assistant reply rebuilds affected chunks

- **WHEN** an assistant message's parts are updated after initial persistence
- **THEN** the next reindex replaces the chunks covering that message and removes any obsolete chunks

#### Scenario: Representation version change rebuilds existing chunks

- **WHEN** the chunker version changes
- **THEN** discovery identifies prior-version projection rows as stale and rebuilds them without mixing versions in the chat's live projection

### Requirement: Only user-visible conversation text is indexed

The chunker SHALL serialize only the text parts of `user` and `assistant` turns. System prompts, tool-role messages, tool invocation payloads/results, model reasoning parts, and attachments MUST NOT enter `search_chat_documents` in any form. Role labels added solely to preserve presentation context MUST appear only in original-cased snippet content and MUST NOT enter the normalized lexical match column or generated FTS vector. Normalization (Unicode NFKC, whitespace collapse, lowercasing for the match column) MUST preserve accents, code, identifiers, and URLs.

#### Scenario: Tool and reasoning content is absent from the projection

- **WHEN** a chat containing tool calls and reasoning parts is indexed
- **THEN** no projection row contains that content, and no search query can match or excerpt it

#### Scenario: Synthetic role labels are absent from lexical data

- **WHEN** a user turn and assistant turn are indexed with no literal `user` or `assistant` text in their bodies
- **THEN** the projection's normalized lexical content and generated FTS vector contain neither synthetic role label, while its snippet content retains role attribution
