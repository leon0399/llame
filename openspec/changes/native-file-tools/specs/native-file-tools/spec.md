## Purpose

Provides one bounded native file interface for local coding and file-backed
Knowledge work, with exact edits, create-only writes, selector-based reads, and
future source/type extensions behind one result shape.

## ADDED Requirements

### Requirement: Native tools operate on absolute local regular files

The native `read`, `edit`, and `write` tools SHALL accept absolute local file
paths and execute with the trusted host process's OS authority in this alpha
capability. They SHALL operate only on regular files in this iteration. A model
argument SHALL NOT select a different executor, owner, tenant, permission mode,
or remote authority. A host that cannot intentionally accept native authority
SHALL leave these tools unavailable rather than silently substituting a hosted
or Sandbox path. A Run SHALL bind to the trusted native executor identity on its
first native operation, including `read`, and SHALL remain bound to it; a later
reattachment to another executor SHALL fail closed rather than resolving the
physical path there.

#### Scenario: Coding file is read by absolute path

- **WHEN** the model calls `read` with an existing absolute regular-file path
- **THEN** the native host reads that file using its OS authority
- **AND** the result identifies the absolute path and does not invent a Knowledge Space binding

#### Scenario: Missing or non-regular target fails

- **WHEN** `read`, `edit`, or `write` targets a missing directory, device, socket, or other non-regular entry
- **THEN** the tool returns a bounded structured error
- **AND** it does not follow a different path or invoke another executor

#### Scenario: Physical path is bound to one executor

- **WHEN** a later worker or host tries to continue a native Run with a different trusted executor identity
- **THEN** the native tool returns an executor-unavailable error
- **AND** it does not resolve the absolute path on the new host

### Requirement: Read selectors and context are deterministic

`read` SHALL accept trailing one-based inclusive selectors `:N-M`, `:N+K`,
`:raw`, and `:raw:N-M`. A valid selector SHALL be normalized once to the internal zero-based
range. Existing literal paths SHALL take precedence over selector parsing.
Ordinary bounded ranges SHALL include one preceding and one following source
line when available. The extended lines SHALL appear in the same `content` block
as the requested lines. Result details SHALL identify requested and shown ranges,
representation, path, and common truncation state. `nextOffset` SHALL identify
the next requested source line. Raw reads SHALL return verbatim selected source
content without generated line prefixes, context expansion, or processors.

#### Scenario: Bounded read includes live adjacent lines

- **WHEN** the model reads lines 11 through 13 of a file with lines on both sides
- **THEN** content contains lines 10 through 14 in source order
- **AND** details identify requested range 11..13 and shown range 10..14

#### Scenario: Boundary range omits unavailable context

- **WHEN** a read starts at line 1 or ends at the file's last line
- **THEN** it omits the unavailable preceding or following context line
- **AND** it does not synthesize a blank source line

#### Scenario: Raw read is verbatim

- **WHEN** the model calls `read` with the `:raw` selector
- **THEN** the result contains the selected source bytes without line prefixes or generated helpers
- **AND** the result remains subject only to common output bounds

#### Scenario: Truncated result reports the shown range

- **WHEN** the common result limit prevents the complete requested/context range from fitting
- **THEN** the tool returns the ordinary truncation metadata and the content prefix it can fit
- **AND** it does not claim that omitted lines were observed

### Requirement: Exact edit replaces one current unique match

`edit` SHALL accept an absolute path, non-empty `oldText`, and `newText`. It
SHALL read the current file at execution time and require exactly one exact
occurrence of `oldText`. A missing or ambiguous occurrence SHALL fail without
mutation. Unrelated changes elsewhere in the file SHALL NOT block a correct
unique replacement. Calls targeting the same path SHALL execute sequentially in
the host runtime. The operation SHALL preserve bytes outside the replacement and
return a bounded diff plus post-edit content with one adjacent live line on each
side when available. No prior read, snapshot tag, read hash, or permission rule
is required in this iteration.

#### Scenario: Unrelated change does not block edit

- **WHEN** another writer changes a different paragraph after the model read, while `oldText` remains one exact match
- **THEN** edit replaces the match and preserves the unrelated change

#### Scenario: Changed target fails without mutation

- **WHEN** another writer changes the exact old text before edit executes
- **THEN** edit returns a stale/missing-target error
- **AND** it does not write the replacement

#### Scenario: Duplicate target fails closed

- **WHEN** `oldText` occurs more than once
- **THEN** edit returns an ambiguity error with no mutation
- **AND** it does not replace every occurrence implicitly

#### Scenario: Sequential same-path calls are first-writer-wins

- **WHEN** two edit calls both request `-Foo +Bar` and `-Foo +Baz` against the same current bytes
- **THEN** the first call applies
- **AND** the second call observes the changed bytes and fails without overwriting the first result

### Requirement: Write creates only

`write` SHALL create a new regular file when the absolute target is absent. It
SHALL fail with `file_exists` when the target already exists, regardless of the
provided content. It SHALL enforce the shared file-size, UTF-8, and output
limits and SHALL leave the existing file unchanged on every failure.

#### Scenario: New file is created

- **WHEN** write targets an absent path with valid bounded content
- **THEN** the file is created atomically
- **AND** the result identifies the created absolute path

#### Scenario: Existing file is protected

- **WHEN** write targets an existing file
- **THEN** the tool returns `file_exists`
- **AND** it does not overwrite or truncate that file

### Requirement: Knowledge read reuses the native reader and is deprecated

The existing `knowledge_read` implementation SHALL reuse the shared logical-line,
range, truncation, and result-shaping primitives while retaining its current
owner and Knowledge Space authorization adapter. Its legacy adapter SHALL keep
the current exact requested-range payload shape while native reads add context.
Its declaration and documentation
SHALL mark it deprecated once generic native-read parity lands. The tool SHALL
remain available until a separately tracked deletion change proves parity and
updates all callers and tests.

#### Scenario: Knowledge read and native read share line semantics

- **WHEN** both adapters read the same live Markdown file and requested range under their respective trusted bindings
- **THEN** their source line splitting, delimiter handling, continuation, and truncation rules agree
- **AND** neither adapter exposes the other's authority fields

#### Scenario: Deprecated tool remains executable during migration

- **WHEN** a current caller invokes `knowledge_read` before the deletion change lands
- **THEN** it continues to receive its existing owner-scoped result contract
- **AND** the declaration identifies the generic native reader as the replacement

### Requirement: Native mutations have a durable pre-effect fence

Before an alpha native `edit` or `write` changes bytes, the trusted runtime SHALL
durably record a stable mutation attempt identity and target operation metadata.
If a retry or recovery observes an unsettled attempt, it SHALL return an unknown
outcome and SHALL NOT invoke the mutation again. A known result SHALL be settled
before the model advances. Client replay SHALL return the stored result without
executing the filesystem operation.

#### Scenario: Retry finds an open native mutation

- **WHEN** a worker dies after recording a native mutation attempt but before settling its result
- **THEN** recovery reports `outcome_unknown`
- **AND** a queue retry does not execute the same edit or write again

#### Scenario: Settled native mutation replays safely

- **WHEN** a client reconnects after a native mutation result was durably settled
- **THEN** replay returns the stored result
- **AND** the filesystem operation is not repeated
