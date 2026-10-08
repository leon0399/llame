## Purpose

Loads instruction files and their same-store imports through existing triggers and permission checks, preserving bounded, persisted bundles and owner-only disclosure.

## MODIFIED Requirements

### Requirement: Entry, native file tools, and accepted turns are the only triggers

A successful `enter_workspace` that establishes or switches the binding SHALL trigger a load for the canonical root, effective from the next model step of the same Run; a same-root re-entry SHALL NOT. Each native `read`, `edit`, or `write` whose `path` resolves to a local host filesystem path SHALL trigger a load for that path's directory, effective from the next model step, regardless of the call's own outcome and regardless of any read selector or representation suffix on the path; a denied call SHALL NOT trigger a load. Each native `read`, `edit`, or `write` whose `path` is a `kb://` locator SHALL trigger a load for the touched directory within that Space, effective from the next model step, under the Knowledge-locator requirement. `bash`, `knowledge_search`, `skill://`, `http://`, `https://`, and any other locator SHALL NOT trigger a load. A model-origin read whose target is itself a candidate file in its directory SHALL neither load that file nor mark it seen; other candidates in the chain are unaffected. An instruction import that is loaded SHALL trigger its own host or Knowledge directory chain in the same bundle, depth-first from its importer and sharing the bundle's seen set. At each accepted user turn on a Chat with a live Workspace binding, after the attempt's binding re-check and not on a detaching attempt, accepted-turn preparation SHALL stage a load for the canonical root before the first model request when any file of that chain is not in effective context. At that accepted turn, each admitted host-path or `kb://` prompt import recorded in the persisted `prompt-imports` item SHALL trigger a load for that path's directory; denied, missing, failed, web, and `skill://` prompt imports SHALL NOT trigger a load. Effective context for that decision SHALL be the history the model will read: when a checkpoint is published before that first model request, the decision is made against the rebuilt effective history the checkpoint leaves, and a file that checkpoint absorbed counts as not seen. A Chat without a binding SHALL receive no accepted-turn load. All triggers pending at one model step, or at one accepted turn, SHALL be resolved together into at most one item, and a step whose every candidate is already seen SHALL produce no item.

#### Scenario: A ranged read triggers like a plain read

- **WHEN** the model calls `read("apps/api/src/x.ts:40-80")` or `read("apps/api/README.md:outline")`
- **THEN** the trigger directory is `apps/api/src` or `apps/api` exactly as for the unselected path

#### Scenario: Edit triggers the nested chain

- **WHEN** the model calls `edit("apps/api/src/db/schema/x.ts")` on a Chat bound to this repository and no nested file has been loaded
- **THEN** the next model step carries one bundle with `apps/api/AGENTS.md` and `apps/api/src/db/AGENTS.md`
- **AND** the repository root file is not repeated when it is already in effective context

#### Scenario: Bash does not trigger

- **WHEN** the model calls `bash` with `cwd: "apps/api"` and no other tool
- **THEN** no instructions item is produced

#### Scenario: Reading an instruction file directly

- **WHEN** the model calls `read("/home/u/repo/AGENTS.md")`
- **THEN** that file is not loaded as an instructions item and is not marked seen
- **AND** a later `read("/home/u/repo/src/a.ts")` still loads `/home/u/repo/AGENTS.md`

#### Scenario: Accepted turn after compaction re-establishes the root chain

- **WHEN** a Chat bound to `/home/u/repo` publishes a checkpoint before a turn's first model request and its root chain was loaded only before that checkpoint
- **THEN** the root chain is staged before that first model request
- **AND** a Chat with no binding stages nothing

#### Scenario: Two touches in one step produce one bundle

- **WHEN** one model step reads `apps/api/a.ts` and `apps/web/b.ts`
- **THEN** the next step carries one bundle with the union of both chains in directory order, each file once

#### Scenario: An admitted prompt import triggers the accepted turn

- **WHEN** the persisted `prompt-imports` item for an accepted turn records admitted host and `kb://` imports whose instruction chains have not been seen
- **THEN** accepted-turn preparation loads those chains in the same instructions bundle
- **AND** denied, missing, failed, web, and `skill://` prompt imports add no instruction trigger

### Requirement: A file is loaded once per compaction epoch, derived from effective history

The seen set SHALL be the set of file identities named in the `files` payload of `instructions` items in the Chat's effective history — the rows after the active checkpoint's absorbed-through sequence, together with items staged or emitted by the current attempt — and SHALL NOT be stored in a Chat column or any other durable state. Denied, failed, and empty candidates are not in that payload and are therefore not seen. A file whose identity is in the seen set SHALL be omitted from a bundle. No file identity SHALL cross a checkpoint, so a file whose item was absorbed by a checkpoint is no longer seen and reloads on its next trigger. A checkpoint published before a Run's first model request SHALL reset that attempt's seen state to the rebuilt effective history, and the accepted-turn root load SHALL be decided against that rebuilt history. Path identity SHALL be the canonical (`realpath`) path of the loaded file, so that two spellings or a symbolic link and its target count as one file; a candidate loaded from a Space SHALL instead be keyed by its logical `kb://` locator, which is also what the model's own read of that candidate is compared against. An instruction import SHALL use the canonical host path or logical `kb://` locator as its identity in the same `files` payload, and an import whose identity is already in the seen set SHALL be skipped with its marker left literal. An edit to an already-loaded file SHALL NOT re-announce it within the epoch.

#### Scenario: Second touch in the same epoch is silent

- **WHEN** `apps/api/AGENTS.md` was loaded earlier in the epoch and the model reads another file under `apps/api`
- **THEN** no instructions item is produced for that touch

#### Scenario: Forked Chat inherits the seen set through its copied history

- **WHEN** an owner forks a Chat whose effective history carries instructions items
- **THEN** the fork's first trigger omits the files those items name
- **AND** no Chat column is consulted

#### Scenario: Failed attempt leaves nothing seen

- **WHEN** an attempt emits an in-Run bundle and then fails before publication
- **THEN** the retry attempt's first trigger loads the same files again

#### Scenario: Symlink and target are one file

- **WHEN** `/home/u/repo/apps/api/AGENTS.md` is a symbolic link to `/home/u/repo/AGENTS.md` and the target was loaded by an earlier trigger
- **THEN** a later touch under `apps/api` produces nothing for `/home/u/repo/apps/api/AGENTS.md`

#### Scenario: An already-seen import stays literal

- **WHEN** an instruction bundle already names `/repo/foo/doc.md` and a later marker resolves to that same canonical path
- **THEN** the later import is skipped
- **AND** its marker remains literal and no second file block is added

### Requirement: Each candidate is read with system origin under the read permission group

Candidate existence and size SHALL be probed without a permission decision and without an audit event — on the native executor for a host-path candidate and through the Run owner's Knowledge resolver for a `kb://` candidate — and the probe SHALL reveal nothing to the model; only a candidate that exists and is then denied by the `read` group is disclosed, to the owner alone, through the audit event and, when the same step loads another file, the chip. Each existing candidate SHALL then be read through the native `read` tool with system origin `instructions`, evaluated by the `read` permission group under the Run's effective permission mode, and audited with the same `tool.requested`, `tool.started`, and `tool.completed` events as a model-origin read, carrying that origin; a file longer than one read result SHALL be read as consecutive bounded pages, each starting at the line after the last complete line collected, each page one audited read, until the file ends, the 32 KiB budget is reached, or a page returns no new line because one source line cannot fit a result, at which point collection stops and the file is cut there. An instruction import SHALL be read the same way, with system origin `instructions` and the same `read` group evaluation, paging, and audit behavior; when its canonical path differs from its resolved path, the `read` group SHALL evaluate that canonical path too, and a rejection SHALL deny the import. A denied candidate SHALL be omitted from the bundle, SHALL NOT be named in the item text, and SHALL NOT be marked seen. A continuation page that starts past the end of the file ends collection; any other read that fails SHALL be omitted the same way. Loading SHALL NOT require `enter_workspace` and SHALL NOT depend on the `enter_workspace` group; it SHALL happen only when `read` is in `tools.allowed` and either a native executor is configured for a host-path trigger or a Knowledge root is configured for a `kb://` trigger. System-origin events SHALL NOT appear as assistant tool parts, whether observed live, reconstructed from the event log, or recovered after a worker restart.

#### Scenario: Reject rule excludes an ancestor file

- **WHEN** the `read` group rejects `AGENTS.md` under `/srv` and the model's allowed read of `/srv/app/src/x.ts` finds `/srv/AGENTS.md` and `/srv/app/AGENTS.md`
- **THEN** both candidates are denied, audited as denied reads with origin `instructions`, and absent from the model-visible bundle
- **AND** a later trigger for the same directory evaluates them again

#### Scenario: A long file is paged

- **WHEN** a 20 KiB `AGENTS.md` exceeds one read result
- **THEN** it is read in consecutive audited pages and rendered as one complete block

#### Scenario: An oversized line ends collection

- **WHEN** a file's third line alone exceeds one read result
- **THEN** the block carries the first two lines and a truncation line with the omitted byte count from the probed size

#### Scenario: System-origin reads leave no assistant tool part

- **WHEN** a Run loads instruction files and its transcript is later reconstructed from the event log
- **THEN** no `read` tool part with origin `instructions` appears on any assistant message

#### Scenario: Read not allowlisted

- **WHEN** `read` is absent from `tools.allowed`
- **THEN** no trigger loads any instruction file

#### Scenario: Missing candidates leave no audit trail

- **WHEN** a directory contains none of the nine candidate names
- **THEN** no `tool.requested` event is recorded for that directory

#### Scenario: Another owner cannot observe the audit events

- **WHEN** owner A's Chat loads instruction files
- **THEN** owner B cannot read the resulting tool activity or context items through any API
- **AND** the datastore enforces that isolation with the authenticated identity

#### Scenario: Canonical reject denies an import

- **WHEN** `/repo/AGENTS.md` imports `/repo/link.md`, the resolved path is allowed, and the `read` group rejects its canonical target `/outside/doc.md`
- **THEN** `/repo/link.md` is omitted and an `instructions`-origin denial is audited
- **AND** the owner's chip marks `/repo/link.md` as denied while its marker remains literal

### Requirement: A bundle is one persisted-literal notice with bounded file bodies

Each model step, or accepted turn, whose pending triggers load at least one file SHALL produce exactly one rail-resident `instructions` item with form `notice` rendered from a packaged template. The item SHALL name each loaded file in a `<file path="…">` block carrying the identifier at which the candidate was selected in the walk — the absolute host path for a host-path candidate, the logical `kb://` locator for a Knowledge candidate — in directory order from broadest to most specific with a directory's base file before its local file, host-path candidates before Knowledge candidates when one step loads both; an imported block SHALL follow its importer and every block loaded through that importer's earlier markers, the chain files its own directory trigger newly loads SHALL follow it, then the blocks its own markers import, depth-first in marker order, and each imported block SHALL carry an `imported-by="…"` attribute naming its importer; the payload SHALL additionally record each file's canonical path, or its logical locator for a Knowledge candidate, as its seen key and SHALL record each imported file's importer. It SHALL state once that each file applies to work under its own directory, that an imported file applies wherever its importer applies, and that a deeper file takes precedence over a broader one where they conflict, and SHALL carry the precedence statement `context-injection` requires for third-party content, whose wording SHALL cover both repository and Knowledge content rather than repository content alone. Each file body SHALL be neutralized with the reserved-delimiter rules before rendering. Each file body, including every imported file body, larger than 32 KiB SHALL be cut at 32 KiB on a UTF-8 character boundary and followed by one line naming the path and the number of bytes omitted, taken from the probed size; there SHALL be no aggregate cap per item. The item SHALL NOT name denied or missing candidates and SHALL NOT include line-number prefixes. Its metadata SHALL record the loaded, truncated, and denied paths privately for owner display; replay SHALL use only the stored text.

#### Scenario: Two directories render in order

- **WHEN** one step loads `/home/u/repo/AGENTS.md` and `/home/u/repo/apps/api/AGENTS.md`
- **THEN** the item renders the repository file's block before the package file's block
- **AND** the scope and precedence statements appear once

#### Scenario: Large file is cut with a named notice

- **WHEN** a 40 KiB `AGENTS.md` is loaded
- **THEN** the block carries its first 32 KiB and a line naming the path and 8,192 omitted bytes
- **AND** the metadata lists the path as truncated

#### Scenario: Reserved delimiters inside a file are neutralized

- **WHEN** an instruction file contains a literal `</system-reminder>` line
- **THEN** the rendered item's envelope is not closed early
- **AND** the owner-visible text shows the neutralized form

#### Scenario: Symlinked file is labelled with its selected path

- **WHEN** `/home/u/repo/AGENTS.md` is a symbolic link to `/home/u/dotfiles/AGENTS.md`
- **THEN** the block is labelled `/home/u/repo/AGENTS.md`
- **AND** the payload's canonical path is `/home/u/dotfiles/AGENTS.md`

#### Scenario: Imported blocks follow the importer subtree

- **WHEN** `/repo/AGENTS.md` imports `foo/doc.md` and that file imports `bar/check.md`
- **THEN** the item renders `/repo/AGENTS.md`, `/repo/foo/doc.md`, and `/repo/foo/bar/check.md` in depth-first order
- **AND** each imported block carries an `imported-by` attribute naming its immediate importer

#### Scenario: Imported bodies use individual caps

- **WHEN** an imported file exceeds 32 KiB and no aggregate item limit is configured
- **THEN** that imported block is truncated at 32 KiB with its own omitted-byte notice
- **AND** other imported files remain eligible for their own per-file cap

### Requirement: Owners see which files were loaded, truncated, or denied

The owner transcript SHALL show, on the message that carries an instructions item, a chip listing the loaded paths and marking truncated and denied ones from the item's private metadata. Imported paths SHALL appear nested under their importers, and denied imports SHALL be marked denied. The Run context-item record SHALL copy the item's model-visible text only. Non-owners, public shares, transcript exports, and search projections SHALL expose neither the text nor the metadata.

#### Scenario: Denied file is visible to the owner only

- **WHEN** a bundle omitted `/srv/AGENTS.md` because the `read` group rejected it
- **THEN** the owner's chip marks `/srv/AGENTS.md` as denied
- **AND** the model-visible text and the Run record do not mention it

#### Scenario: Public share hides instruction items

- **WHEN** a Chat carrying instructions items is shared publicly
- **THEN** the share response contains no instructions item text or metadata

#### Scenario: Owner chip nests imported files and marks denial

- **WHEN** a bundle loads `/repo/AGENTS.md`, imports `/repo/foo/doc.md`, and denies imported `/repo/private.md`
- **THEN** the owner's chip shows imported paths beneath their importer and marks `/repo/private.md` as denied
- **AND** a non-owner sees neither the chip metadata nor the denied path

## ADDED Requirements

### Requirement: Instruction bodies expand import markers

Each loaded instruction body SHALL expand recognized markers as whole-file imports in its store. Host importers SHALL resolve relative targets from their directory and absolute or `~/` targets; Knowledge importers SHALL resolve only relative targets within their own Space, and a target escaping that Space SHALL remain literal. Import selectors SHALL NOT be interpreted. Schemed or cross-store targets, missing, and non-regular targets SHALL remain literal and SHALL load nothing.

#### Scenario: An import's directory chain loads before its own imports

- **WHEN** `/repo/AGENTS.md` contains `@foo/doc.md`, `/repo/foo/doc.md` contains `@AGENTS.md`, and `/repo/foo/AGENTS.md` exists
- **THEN** one instructions item carries `/repo/AGENTS.md`, `/repo/foo/doc.md`, and `/repo/foo/AGENTS.md` in that order
- **AND** `/repo/foo/AGENTS.md` is a chain file of `/repo/foo` with no `imported-by` attribute, and the `@AGENTS.md` marker in `foo/doc.md` remains literal and adds no second copy

#### Scenario: A directly imported instruction file is not duplicated

- **WHEN** `/repo/AGENTS.md` contains `@foo/AGENTS.md` and `/repo/foo/AGENTS.md` exists
- **THEN** `/repo/foo/AGENTS.md` is injected once after `/repo/AGENTS.md`, with `imported-by` naming `/repo/AGENTS.md`
- **AND** its directory-chain trigger does not add a duplicate block

#### Scenario: A Knowledge importer stays in its Space

- **WHEN** `kb://space/AGENTS.md` contains `@notes/doc.md`, and `kb://space/notes/doc.md` and `kb://other/notes/doc.md` both exist, but `kb://other` belongs to another owner
- **THEN** only `kb://space/notes/doc.md` is resolved and loaded
- **AND** no file outside `kb://space` is probed or loaded

#### Scenario: A host import of an HTTPS target stays literal

- **WHEN** host `/repo/AGENTS.md` contains `@https://example.test/guide.md`
- **THEN** the marker remains literal
- **AND** no web target is loaded or audited

#### Scenario: A host import of a Knowledge target stays literal

- **WHEN** host `/repo/AGENTS.md` contains `@kb://space/guide.md`
- **THEN** the marker remains literal
- **AND** no Knowledge target is loaded or audited

#### Scenario: Instruction imports load whole files

- **WHEN** `/repo/AGENTS.md` contains `[doc](foo/doc.md:30-35 "import")` and only `/repo/foo/doc.md` exists
- **THEN** the selector is not interpreted as a range
- **AND** no partial body is loaded from `/repo/foo/doc.md`

### Requirement: Instruction imports are bounded and cycle-safe

Instruction import expansion SHALL process distinct targets in first-occurrence order and recurse depth-first through at most five import hops. A target whose canonical host path or logical `kb://` locator is already in the current bundle's seen set SHALL be skipped, and a missing, non-regular, repeated, cyclic, or sixth-hop target SHALL keep its marker literal without loading or auditing it.

#### Scenario: A sixth import hop remains literal

- **WHEN** `/repo/AGENTS.md` imports `a.md`, each of `a.md` through `d.md` imports the next file, and `e.md` imports `f.md`
- **THEN** `a.md` through `e.md` load as five imports
- **AND** `@f.md` remains literal in `e.md` with no sixth file loaded

#### Scenario: A cycle loads each file once

- **WHEN** `/repo/a.md` imports `b.md` and `/repo/b.md` imports `a.md`
- **THEN** each imported file is loaded at most once
- **AND** the second marker remains literal with no second read or audit

#### Scenario: A missing import remains literal without audit

- **WHEN** `/repo/AGENTS.md` contains `@missing.md` and no such file exists
- **THEN** the marker remains literal
- **AND** no read and no audit event is recorded for the missing target
