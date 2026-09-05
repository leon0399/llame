# search-embeddings

## Purpose

The **embedding layer** is a derived, fully rebuildable vector representation of the lexical search projection: at most one embedding per document chunk, produced asynchronously through a provider-neutral backend and valid only while the content it was derived from is unchanged. It covers the operator-declared embedding-model catalog and per-corpus model selection, the content-hash validity rule that keeps stale and deleted content unrecoverable, asynchronous production and operator-invoked bulk work, terminal-failure handling, and fail-closed degrade when no model is configured. It produces vectors and constrains how the query path reads them: model-key and content-hash validity, the input-version filter, and the corpus binding the query is embedded under.

## Requirements

### Requirement: The embedding layer is derived state that enhances but never gates search

Embeddings SHALL be derived from the lexical search projection, which is itself derived from canonical `chats`/`messages`. The layer MUST be fully rebuildable at any time from that canonical content, and MUST NOT modify canonical tables or any document's lexical content. Retrieval behavior SHALL degrade gracefully — not into an error — when embeddings are absent; a partially embedded corpus remains fully searchable by its lexical representations. Lexical recall floors SHALL hold with and without vectors.

#### Scenario: Lexical floors hold without embeddings

- **WHEN** the recorded relevance eval runs on an instance with no embeddings at all
- **THEN** every floor category (exact-title, exact-content, substring, code, typo) still places the expected chat in the top 10

#### Scenario: Full rebuild reproduces the vector layer

- **WHEN** every embedding is cleared and the bulk backfill runs to completion
- **THEN** every document the corpus's model can embed carries a vector again, and no canonical or lexical content was modified

### Requirement: Embedding models are declared under stable internal keys

Embedding models SHALL be declared with a stable internal key that application code and stored vectors reference, recording provider connection, provider-side model identifier, revision, dimensions, distance metric, optional asymmetric document and query prefixes, and request batch size. Provider-side identifiers SHALL NOT leak past the backend adapter into stored rows, application interfaces, logs, or any user- or model-visible surface.

Redefining an in-use key to a different provider model or revision SHALL be rejected at startup, naming the key and the changed field, rather than silently reinterpreting existing vectors. Registering the changed model under a new key is the supported path.

#### Scenario: Stored vectors reference the internal key only

- **WHEN** an embedding is persisted
- **THEN** the row identifies its model by internal key, and no provider name or provider-side model identifier is stored with it

#### Scenario: Changing the provider model under an in-use key is rejected

- **WHEN** an operator points an existing internal key at a different provider-side model or revision after vectors exist for it
- **THEN** startup fails naming the key and the changed field, and no vector is reinterpreted

### Requirement: One model serves a corpus at a time, selected per corpus

Model selection SHALL be per corpus rather than one instance-wide flag, so corpora embedding at different rates cannot strand one another. A document SHALL carry at most one vector, recorded together with the model key that produced it. Changing a corpus's model SHALL NOT delete or rewrite existing vectors; they become unmatched by the current selection and are replaced as re-embedding proceeds.

#### Scenario: A second corpus is unaffected by another corpus's model choice

- **WHEN** one corpus's intended model is changed
- **THEN** every other corpus continues to use its own selection, and no job or query treats the difference as an error

#### Scenario: Changing the model regenerates nothing on its own

- **WHEN** a corpus's intended model is changed to another declared key
- **THEN** no vector is deleted or rewritten, no provider request is issued, and re-embedding happens only when the operator runs the bulk command

### Requirement: Retrieval degrades rather than gates, and never mixes embedding spaces

There SHALL be no completeness gate: a partially embedded corpus SHALL remain retrievable, with the vector contribution present for documents that have a usable vector and absent for those that do not — retrieval degrades in quality, never into an error or a refusal. Any query reading vectors SHALL restrict itself to documents whose recorded model key matches the corpus's current selection, whose embedded content hash equals the live content hash, and whose recorded input version equals the current `EMBED_INPUT_VERSION`, so vectors produced by different models, for superseded content, or under a superseded input derivation are never compared within one ranking. The query SHALL be embedded under the same binding as the stored vectors — the corpus's selected model key, its revision, its query-side prefix, and its declared dimensions — and a query vector whose dimension differs from the declaration SHALL be treated as absent rather than compared.

#### Scenario: A partially embedded corpus is still fully searchable

- **WHEN** only part of a corpus has been embedded
- **THEN** every document remains retrievable by its lexical representations, and no search is refused or degraded to an error

#### Scenario: Vectors from a superseded model never enter a ranking

- **WHEN** a corpus's model has changed and some documents still carry vectors from the previous key
- **THEN** those vectors contribute nothing, and the ranking contains no comparison between vectors of different models

#### Scenario: Query is embedded under the corpus binding

- **WHEN** a search embeds its query
- **THEN** the request uses the corpus's selected model key, revision, and query-side prefix
- **AND** a returned vector whose dimension differs from the declared `dimensions` is discarded and the vector leg is skipped

### Requirement: Embedding storage inherits the projection's tenant isolation

Embeddings SHALL be stored on the projection rows they describe, under the projection's existing datastore-enforced isolation: RLS `ENABLE` and `FORCE`, an owner policy over the request identity, and no public-read policy. No separate isolation surface SHALL be introduced. Because a vector is a lossy but real encoding of content, cross-tenant and public-chat negative tests SHALL cover the embedding columns explicitly rather than relying on the lexical assertions alone.

#### Scenario: FORCE RLS holds against the table owner for embeddings

- **WHEN** the row-level-security suite reads the embedding columns as the owning role with another user's identity set, and again with the empty identity
- **THEN** no cross-tenant row and no public chat's row is readable

#### Scenario: Deleting a chat removes its vectors

- **WHEN** a chat is deleted
- **THEN** no embedding derived from any of its content remains

### Requirement: Document size is bounded, and the bound is what the embedding layer sizes for

The projection SHALL guarantee a **stated upper bound** on document size, so a document is always at most one vector and the embedding layer can size its headroom against a real number rather than an assumption. Embedding SHALL NOT truncate, sample, or otherwise silently discard part of a document: content that cannot be embedded whole is a projection defect, not something the embedding layer resolves by dropping the tail.

The bound is **not** the per-message chunk budget, and the `search-projection` capability owns its exact value. The embedding layer SHALL size its headroom against whatever bound the projection states, rather than against the per-message budget — assuming the smaller number is the mistake this requirement exists to prevent.

#### Scenario: An oversized message is represented in full

- **WHEN** a chat contains a single message far larger than the chunk budget
- **THEN** every part of that message is represented by some document, and no part of it is discarded

#### Scenario: The stated bound holds even with overlap carry

- **WHEN** consecutive messages are each close to the chunk budget, so a chunk carries an overlap block alongside a full block
- **THEN** the resulting document is within the stated bound, and the bound is asserted by test rather than assumed

### Requirement: An embedding is valid only while its source content and input version are unchanged

Embedding input SHALL be the document's presentation content as stored, including role markers and original casing, accents, and punctuation; the lexically normalized representation SHALL NOT be used as embedding input. Embedding input SHALL carry an explicit input version so a future change to what is embedded is enumerable even when no content hash changes.

Every embedded document SHALL record the content hash and input version it was produced from, and its vector SHALL be treated as valid only while both still match. A produced embedding whose recorded hash or version no longer matches SHALL be discarded and never persisted. Content that has been edited or deleted MUST NOT become recoverable through a late-arriving result. Rewriting a document's content SHALL clear its embedding in the same operation, so a stale vector cannot outlive the content it describes.

#### Scenario: Presentation content reaches the backend unmodified

- **WHEN** a document is embedded
- **THEN** the text sent to the backend is its stored presentation content byte for byte, and the lexically normalized representation is never sent

#### Scenario: Result for edited content is dropped

- **WHEN** a document's content changes after its embedding was requested but before the result is persisted
- **THEN** the result is discarded, no vector is written for the superseded content, and the document is re-queued for the current content

#### Scenario: Result for deleted content restores nothing

- **WHEN** a document is deleted after its embedding was requested and the result then arrives
- **THEN** nothing is written, and the deleted content is not represented anywhere

#### Scenario: Rewriting content clears its vector

- **WHEN** a rebuild replaces a document's content in place
- **THEN** that document carries no embedding until it is re-embedded against the new content

#### Scenario: An input-version bump invalidates existing vectors

- **WHEN** the embedding input derivation changes and its version is bumped
- **THEN** every vector produced under the previous version is reported as needing work and is re-embedded, even though no content hash changed

### Requirement: Provider access is confined to a neutral backend boundary

Embedding production SHALL go through a provider-neutral interface exposing document and query embedding operations. Provider request and response formats, endpoints, and credentials SHALL remain internal to an adapter behind that interface. A returned vector SHALL be validated for the declared dimensions and for finite values before it is persisted; a result failing validation SHALL be rejected rather than stored. Results SHALL be correlated to requests by an explicit identifier carrying model key, document, and content hash — never by response ordering.

#### Scenario: A provider swap changes no consumer

- **WHEN** the configured backend is changed from a self-hosted endpoint to a hosted one, or the reverse
- **THEN** no code outside the adapter changes, and stored vectors remain addressable by their internal model key

#### Scenario: A malformed vector is rejected

- **WHEN** a provider returns a vector whose length differs from the declared dimensions, or containing a non-finite value
- **THEN** the result is rejected with a logged error, nothing is persisted, and the document remains outstanding

#### Scenario: Results are correlated explicitly, not positionally

- **WHEN** a batch of results returns in a different order than requested, or partially
- **THEN** each result is matched to its document by its explicit identifier, and any unmatched result is discarded

### Requirement: Embedding production is asynchronous and never delays a turn

Embedding work SHALL be produced asynchronously on a queue separate from lexical reindexing, and SHALL be enqueued after commit by **every** path that changes a chat's projection — the inline turn-completion rebuild, the asynchronous reindex worker, and fork — so an ordinary turn on a configured instance produces embedding work without waiting for a sweep. Enqueue SHALL be coalesced per chat. Completed batches SHALL be persisted as they finish rather than at the end of a job, so a retry repeats only unfinished work.

Embedding MUST NOT run inside a user-facing write, MUST NOT delay turn completion, and MUST NOT fail a user-facing write or a lexical rebuild. Lexical freshness SHALL be unaffected; embedding freshness MAY lag, and a bounded lag is not an error state.

#### Scenario: An ordinary turn produces embedding work

- **WHEN** a turn finalizes through the inline rebuild path on an instance with a model configured
- **THEN** embedding work for that chat is enqueued once the rebuild has committed, without depending on a sweep or on a reindex job having run

#### Scenario: A turn completes at lexical speed

- **WHEN** a turn finalizes on an instance with embeddings configured
- **THEN** the turn's content is lexically searchable on that request's completion exactly as before, and the embedding work is queued rather than awaited

#### Scenario: Embedding failure does not damage the lexical projection

- **WHEN** the embedding backend is unreachable or returns errors for a period
- **THEN** lexical indexing, search, and turn completion continue unaffected, and affected documents remain outstanding for retry

#### Scenario: A retry repeats only unfinished work

- **WHEN** a chat's embedding job fails partway after several batches have been persisted
- **THEN** the retry embeds only the documents still outstanding, and issues no provider request for those already persisted

### Requirement: Terminal failures are recorded so they are neither retried forever nor hidden

A document whose embedding fails terminally SHALL record a failure reason alongside the model key, content hash, and input version it was attempted under, and SHALL NOT be automatically retried at that same content. Only a terminal provider rejection SHALL be recorded this way; transient conditions SHALL be retried under the queue's retry policy.

The distinction between never attempted, embedded, and terminally failed SHALL be derived from recorded state rather than stored as a separate status. Attempt state SHALL be written only at persist time, together with the vector or the failure reason, so a partially written row is treated as still needing work rather than as settled.

A recorded failure SHALL be superseded automatically when the content, input version, or model changes, and SHALL be clearable by an explicit operator command for the case where none of those change.

#### Scenario: A permanently unembeddable document stops being retried

- **WHEN** a document's embedding is rejected terminally by the provider
- **THEN** the failure and its reason are recorded, the document is no longer reported as needing work at that content, and it is not re-enqueued by any automatic discovery

#### Scenario: A transient failure is retried, not recorded as terminal

- **WHEN** an embedding request fails because the backend is unreachable, times out, or is rate-limited
- **THEN** no failure is recorded against the document and the work is retried

#### Scenario: Editing the content retries a failed document

- **WHEN** a message underlying a terminally failed document is edited
- **THEN** the recorded failure no longer applies and the document is attempted again

#### Scenario: An operator can retry failures without changing content

- **WHEN** the operator runs the retry-failed command
- **THEN** recorded failures are cleared and those documents are attempted again on the next pass

#### Scenario: A failed document remains lexically searchable

- **WHEN** a document has a recorded terminal failure
- **THEN** it is retrievable by its lexical representations exactly as any other document, and no query treats it as a special case

### Requirement: Embedding lag is discoverable cross-tenant, and its provisioning is verified at startup

Discovery of documents needing embedding work SHALL use a predicate over **embedding coverage**, not lexical staleness: a document fully indexed lexically but never embedded, or embedded under a superseded content hash, input version, or model key, SHALL be discoverable. The existing lexical staleness predicate cannot express any of these and SHALL NOT be relied on for it. The predicate SHALL be null-safe, so a never-embedded document — whose recorded model key, hash, and version are all absent — is always discovered rather than silently excluded by a null comparison.

Because this enumeration crosses tenants under FORCE RLS, it SHALL use a `SECURITY DEFINER` function owned by a BYPASSRLS role returning **identifiers only** — never content and never vectors — after which all document reads happen inside per-owner scopes. Ownership provisioning SHALL be verified at startup by reading catalog metadata only, and a mis-provisioned state SHALL be surfaced as a loud error-level log rather than silently returning zero rows. The check MUST NOT crash the process and MUST NOT affect lexical indexing or search.

#### Scenario: A never-embedded but fully indexed chat is discovered

- **WHEN** a chat's lexical projection is current and none of its documents have been embedded under the corpus's model
- **THEN** the discovery predicate returns it, even though no lexical staleness exists and no attempt state is recorded

#### Scenario: Mis-provisioned discovery is reported at boot

- **WHEN** the coverage-discovery function is not owned by a BYPASSRLS role
- **THEN** a loud error-level log is emitted, the process does not crash, lexical indexing and search are unaffected, and the state is not mistaken for a fully covered corpus

#### Scenario: Discovery leaks no content

- **WHEN** the coverage-discovery function executes
- **THEN** it returns only chat identifiers, owner ids, and counts; no message content and no vector leaves it

### Requirement: Bulk embedding work is explicit; only incremental lag is automatic

Automatic discovery and enqueueing SHALL cover only _incremental_ lag — content added or edited under the corpus's current model. _Bulk_ work — a newly declared model, a model change, or an input-version bump invalidating existing vectors — SHALL be advanced only by an explicit operator command, never as a side effect of editing configuration. A configuration edit SHALL NOT by itself initiate embedding work proportional to corpus size.

The bulk command SHALL enumerate and enqueue rather than embed directly, so it is resumable, observes the configured concurrency, and requires no provider credential of its own. Re-running it against a fully covered corpus SHALL issue no provider request and write nothing.

#### Scenario: Declaring or changing a model starts no work

- **WHEN** an operator declares a new embedding model, or points a corpus at a different declared key
- **THEN** no provider request is issued and no corpus-wide job is created; startup logs the coverage gap and names the command that would close it

#### Scenario: Ordinary activity still embeds automatically

- **WHEN** a turn completes on a corpus with a configured model
- **THEN** that chat's new content is enqueued and embedded without operator action

#### Scenario: Re-running the bulk command costs nothing

- **WHEN** the bulk command runs a second time against an already-covered corpus
- **THEN** no provider request is issued and no row is written

### Requirement: Coverage is observable as distinct counts

Embedding progress SHALL be observable per chat and reported as **embedded**, **failed**, and **outstanding** counts kept distinct, so lag is distinguishable from permanent failure and neither is folded into a single "covered" figure. Progress SHALL be reported separately from the lexical indexing state it does not affect.

#### Scenario: Lag is distinguishable from failure

- **WHEN** an operator inspects a chat during a partial backfill where one document has failed terminally
- **THEN** the embedded, failed, and outstanding counts are separately visible, and the lexical indexed-at state is shown independently

### Requirement: The embedding layer is off by default and enabled only through operator config

The embedding layer SHALL be disabled unless an operator explicitly declares it in the instance config file. Enablement SHALL come only from that file — there SHALL be no environment-variable switch, no database-stored setting, and no per-user, per-tenant, or per-chat control, because background indexing is instance-scoped operator behavior rather than tenant preference. A default installation SHALL therefore behave exactly as it did before this capability existed.

With no model configured, or with the configured backend unavailable, the instance SHALL start and run normally with lexical search unchanged. Absent configuration SHALL NOT be an error path, SHALL NOT fail boot, and SHALL NOT emit recurring error-level noise.

#### Scenario: A default installation has embeddings off

- **WHEN** an instance is installed and started without editing the config file
- **THEN** the embedding layer is inert: no vector is produced, no queue is created, no provider is contacted, and search behaves exactly as before

#### Scenario: Enablement is not reachable outside the config file

- **WHEN** an operator sets an environment variable, or a user changes any account or chat setting, intending to enable embeddings
- **THEN** nothing enables the layer; only declaring a model and selecting it for a corpus in the config file does

### Requirement: Credentials and configuration never enter derived content

Provider credentials, endpoints, and configuration text SHALL never be written into document content, embedding state, logs, errors, or diagnostics. An error concerning a model entry SHALL identify it by internal key and field name, never by resolved value. A recorded failure reason SHALL be safe to display and SHALL NOT carry request bodies, credentials, or endpoint secrets.

#### Scenario: A backend error names no secret

- **WHEN** the embedding backend fails authentication
- **THEN** the logged error names the model key and the failing field, and contains no credential, no endpoint secret, and no interpolated value

### Requirement: pgvector is a declared platform dependency

The `vector` extension SHALL be a declared platform dependency. Unlike `pg_trgm`, it is absent from the stock Postgres image, so the development, test, and CI database images SHALL provide it, and pgvector SHALL be documented as a self-host deployment requirement.

Unlike `pg_trgm`, `vector` is **not a trusted extension**: installing it requires superuser, which the non-superuser role that owns the schema and runs migrations does not have. Its installation is therefore **provisioning, not migration** — performed once against a fresh database by the superuser, in the same class as the roles that migrations only reference. The migration SHALL still declare the dependency idempotently, which is a harmless no-op for the migrating role once the extension exists.

Because provisioning precedes migration, an **existing** database predating this requirement SHALL fail its next migration with a clear permission error rather than proceeding into a partially provisioned state, and that upgrade path SHALL be documented.

#### Scenario: Fresh database provisions cleanly

- **WHEN** a fresh database is provisioned and migrations then run as the non-superuser owner role
- **THEN** the extension is present, the embedding schema is created, and the migration's own extension declaration succeeds as a no-op

#### Scenario: An unprovisioned existing database fails loudly

- **WHEN** migrations run against a database where the extension was never provisioned
- **THEN** migration fails naming the missing privilege and extension, rather than starting into a partially provisioned state

#### Scenario: A database without pgvector fails loudly at migration

- **WHEN** migrations run against an image lacking the `vector` extension
- **THEN** migration fails with an error naming the missing extension, rather than the application starting into a partially provisioned state
