## Purpose

Loads instruction files and their same-store imports through existing triggers and permission checks, preserving bounded, persisted bundles and owner-only disclosure.

## MODIFIED Requirements

### Requirement: A host-path trigger loads the chain from the filesystem root down to the touched directory

An entry trigger and a native `read`, `edit`, or `write` whose `path` is a local host filesystem path SHALL each name one directory `D` on the native executor host. A loaded instruction import and an admitted host-path prompt import SHALL each name one directory `D` on the native executor host, chosen exactly as for a native read of the import's resolved path: the path itself when it is an existing directory, and otherwise its parent directory. The load SHALL consider every directory from the filesystem root down to `D` inclusive, in that order, and SHALL include ancestors above any Workspace root or repository boundary. `D` SHALL be the canonical Workspace root for an entry trigger; for a file-tool trigger it SHALL be the projected absolute path itself when that path is an existing directory, and otherwise the parent directory of the projected absolute path, whether or not that path exists. The walk SHALL NOT descend into siblings or children of `D`. A trigger whose `path` is a `kb://` locator SHALL NOT walk the host filesystem; it SHALL follow the Knowledge-locator requirement instead.

#### Scenario: Entry loads the root and its ancestors

- **WHEN** `enter_workspace("/home/u/repo/apps/api")` succeeds and `/home/u/repo/AGENTS.md` and `/home/u/repo/apps/api/AGENTS.md` exist
- **THEN** one bundle carries `/home/u/repo/AGENTS.md` then `/home/u/repo/apps/api/AGENTS.md`

#### Scenario: File touch outside the Workspace still walks its ancestors

- **WHEN** a Chat bound to `/home/u/repo` reads `/home/u/other/src/x.ts` and `/home/u/other/AGENTS.md` exists
- **THEN** the bundle carries `/home/u/other/AGENTS.md`
- **AND** the Workspace root's own files are not reloaded by that trigger

#### Scenario: Write into a directory that does not exist yet

- **WHEN** `write("/home/u/repo/apps/web/src/new.tsx")` targets a directory whose parent chain contains `/home/u/repo/apps/web/AGENTS.md`
- **THEN** that file is loaded from the next model step, whether or not the write succeeded, unless the call was denied

#### Scenario: Reading a directory loads that directory's own chain

- **WHEN** the model reads the existing directory `apps/api` on a Chat bound to `/home/u/repo`
- **THEN** `D` is `/home/u/repo/apps/api`, so `/home/u/repo/apps/api/AGENTS.md` is a candidate

#### Scenario: An import trigger walks from its resolved directory

- **WHEN** a loaded instruction import or an admitted host-path prompt import resolves to `/home/u/repo/apps/api/doc.md` and `/home/u/repo/AGENTS.md` and `/home/u/repo/apps/api/AGENTS.md` exist
- **THEN** the import names `/home/u/repo/apps/api` as `D` and loads the same chain from the filesystem root down to `D`

#### Scenario: A prompt import of a directory loads that directory's own chain

- **WHEN** an admitted host-path prompt import resolves to the existing directory `/home/u/repo/apps/api` and `/home/u/repo/apps/api/AGENTS.md` exists
- **THEN** the import names `/home/u/repo/apps/api` itself as `D` and loads that directory's own chain from the filesystem root down to `D`

### Requirement: A Knowledge locator loads the chain within its Space

A `read`, `edit`, or `write` whose `path` is a `kb://<spaceId>/<relative path>` locator SHALL load the same candidate chains, with the same selection rules, from the root of that Space down to the touched directory inclusive, and SHALL NOT consider any directory above that Space root: not the operator's `knowledge.root` directory, which holds every owner's Spaces, not a host ancestor of it, and not another Space. The touched directory SHALL be the locator's own directory when it names an existing directory in that Space, and otherwise the parent directory of the locator's path within that Space. A candidate that the Knowledge resolver refuses as a symbolic link SHALL NOT be selected and its chain SHALL continue.

Space resolution and every candidate probe SHALL run under the Run owner's identity through the owner-scoped Knowledge resolver. A locator naming another owner's Space, a Space that does not exist, and a Space that is unavailable SHALL each load nothing, probe nothing, and record no audit event.

Every selected candidate SHALL be labelled and keyed by its logical locator `kb://<spaceId>/<relative path>`, percent-encoded exactly as the Knowledge locator formatter produces it, and that logical locator SHALL be the item's `path` and its seen key; no host path SHALL appear in the item's text, payload, metadata, audit events, or owner chip. Each selected candidate SHALL be read through the native `read` tool with its `kb://` locator and bounded `:raw:<from>-<to>` pages, under system origin `instructions`, evaluated by the `read` permission group exactly as a host candidate is.

Loading SHALL occur only for a locator whose Space identifier is already the canonical lower-case form the Knowledge locator formatter produces; a locator whose Space identifier contains an upper-case letter SHALL load nothing, probe nothing, and record no event, and the model's own read of that locator SHALL proceed normally under the spelling it wrote. Grouping, labels, seen keys, and every candidate page read SHALL use that one canonical spelling, so the `read` group evaluates the injection under exactly the locator the model's own read of that candidate uses.

A bundle carrying at least one Knowledge candidate SHALL include the closed Knowledge untrusted-content notice `knowledge-tools` defines exactly once, and a bundle carrying only host-path candidates SHALL NOT include it.

A model `kb://` trigger SHALL NOT produce an accepted-turn load, and a Workspace entry SHALL NOT produce an accepted-turn load for a Space, because a Space has no Workspace binding; an admitted `kb://` prompt import SHALL load its Space chain on its accepted turn. A `kb://` import naming an entry the Knowledge resolver refuses as a symbolic link SHALL load nothing and its marker SHALL remain literal. Candidates loaded for one step from host-path triggers and from `kb://` triggers SHALL resolve into at most one item, with the host files first, then the Knowledge files, each group from its broadest directory and a base file before its local file.

#### Scenario: A read in a Space loads that Space's chain from its root

- **WHEN** the model reads `kb://<space>/notes/lore/x.md` and `<space>/CLAUDE.md` and `<space>/notes/lore/AGENTS.md` exist
- **THEN** one bundle carries `kb://<space>/CLAUDE.md` then `kb://<space>/notes/lore/AGENTS.md`
- **AND** neither file is named by any host path

#### Scenario: A file above the Space root is never loaded

- **WHEN** a Space is resolved under the operator's `knowledge.root` and a candidate chain name also exists above that Space's own root
- **THEN** the bundle carries no file from outside the Space root

#### Scenario: Another owner's Space loads nothing

- **WHEN** the model reads `kb://<other-owner-space>/notes/x.md` from a Run owned by a different owner
- **THEN** no instructions item is produced, no candidate in that Space is probed, and no event with origin `instructions` is recorded

#### Scenario: A search hit does not trigger

- **WHEN** a `knowledge_search` result names a file that holds a candidate chain name
- **THEN** no instructions item is produced for that result

#### Scenario: The bundle names logical locators only

- **WHEN** a step loads candidates from a Space
- **THEN** the item text and the `files` payload carry `kb://<spaceId>/<relative path>` values
- **AND** no host path appears in the text, the payload, the metadata, or the audit events

#### Scenario: An upper-case Space identifier is not a trigger

- **WHEN** the model calls `read("kb://<Space>/notes/x.md")`, where `<Space>` spells a Space's identifier with upper-case letters, and that Space holds `CLAUDE.md`
- **THEN** no instructions item is produced, no candidate in that Space is probed, and no event with origin `instructions` is recorded
- **AND** the model's own read of that locator still runs and returns the named file

#### Scenario: A Space bundle carries the Knowledge notice once

- **WHEN** one step loads candidates from a Space, with or without host-path candidates
- **THEN** the item includes the closed Knowledge untrusted-content notice exactly once
- **AND** a bundle of host-path candidates only carries no such notice

#### Scenario: An admitted Knowledge prompt import is the accepted-turn exception

- **WHEN** an unbound Chat admits a `kb://<space>/notes/lore/x.md` prompt import and `<space>/CLAUDE.md` and `<space>/notes/lore/AGENTS.md` exist
- **THEN** the Space chain loads on that accepted turn
- **AND** a model `kb://` trigger or a Workspace entry does not produce an accepted-turn load for that Space

### Requirement: Entry, native file tools, and accepted turns are the only triggers

A successful `enter_workspace` that establishes or switches the binding SHALL trigger a load for the canonical root, effective from the next model step of the same Run; a same-root re-entry SHALL NOT. Each native `read`, `edit`, or `write` whose `path` resolves to a local host filesystem path SHALL trigger a load for that path's directory, effective from the next model step, regardless of the call's own outcome and regardless of any read selector or representation suffix on the path; a denied call SHALL NOT trigger a load. Each native `read`, `edit`, or `write` whose `path` is a `kb://` locator SHALL trigger a load for the touched directory within that Space, effective from the next model step, under the Knowledge-locator requirement. `bash`, `knowledge_search`, `skill://`, `http://`, `https://`, and any other locator SHALL NOT trigger a load. A model-origin read or a prompt import whose target is itself a candidate file in its directory SHALL neither load that file nor mark it seen; other candidates in the chain are unaffected. An instruction import that is loaded SHALL trigger its own host or Knowledge directory chain in the same bundle, depth-first from its importer and sharing the epoch seen set. At each accepted user turn on a Chat with a live Workspace binding, after the attempt's binding re-check and not on a detaching attempt, accepted-turn preparation SHALL stage a load for the canonical root before the first model request when any file of that chain is not in effective context. At that accepted turn, each admitted host-path or `kb://` prompt import recorded in the persisted `prompt-imports` item SHALL trigger a load for that path's directory regardless of Workspace binding and of its read outcome after admission. Prompt-import triggers SHALL be gated exactly like in-Run triggers: a host-path trigger needs `read` allowlisted and a native executor, and a `kb://` trigger needs `read` allowlisted and a Knowledge root; denied, missing, web, and `skill://` prompt imports SHALL NOT trigger a load. The persisted item SHALL record, for each attempted target, whether it was admitted and its resolved absolute host path or canonical `kb://` locator, so accepted-turn preparation rebuilds these triggers from the item. Effective context for that decision SHALL be the history the model will read: when a checkpoint is published before that first model request, the decision is made against the rebuilt effective history the checkpoint leaves, and a file that checkpoint absorbed counts as not seen. A Chat without a binding SHALL receive no accepted-turn load. That no-binding rule applies to the root load only; prompt-import triggers are an explicit exception and do not require a Workspace binding. All triggers pending at one model step, or at one accepted turn, SHALL be resolved together into at most one item, and a step whose every candidate is already seen SHALL produce no item.
A detaching attempt SHALL perform no new prompt imports and SHALL stage no prompt-import instruction triggers; a non-detaching retry SHALL rebuild prompt-import triggers from the persisted resolved paths.

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

#### Scenario: An unbound Chat imports an absolute host file

- **WHEN** an unbound Chat's prompt imports an admitted absolute host file while `read` is allowlisted and a native executor is available, and that file's directory has an instruction chain
- **THEN** that directory's chain loads on that accepted turn
- **AND** no Workspace binding is required for the trigger

#### Scenario: An unbound Chat imports a Knowledge file without a native executor

- **WHEN** an unbound Chat's prompt imports an admitted `kb://` file while `read` is allowlisted and a Knowledge root is available but no native executor is available, and that file's Space directory has an instruction chain
- **THEN** that Space chain loads on that accepted turn
- **AND** no Workspace binding or native executor is required for the trigger

#### Scenario: An admitted prompt import triggers the accepted turn

- **WHEN** the persisted `prompt-imports` item for an accepted turn records admitted host and `kb://` imports whose instruction chains have not been seen, including one whose read fails after admission
- **THEN** accepted-turn preparation loads those chains in the same instructions bundle
- **AND** denied, missing, web, and `skill://` prompt imports add no instruction trigger

#### Scenario: A persisted prompt-imports item replays on a detaching retry

- **WHEN** an earlier attempt persisted a `prompt-imports` item and a retry detaches before prompt imports run
- **THEN** the item remains on the user message and replays unchanged as stored text, without being re-read or removed
- **AND** no new prompt imports occur and no prompt-import instruction triggers are staged

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

Candidate existence and size SHALL be probed without a permission decision and without an audit event — on the native executor for a host-path candidate and through the Run owner's Knowledge resolver for a `kb://` candidate — and the probe SHALL reveal nothing to the model; only a candidate that exists and is then denied by the `read` group is disclosed, to the owner alone, through the audit event and, when the same step loads another file, the chip. Each existing candidate SHALL then be read through the native `read` tool with system origin `instructions`, evaluated by the `read` permission group under the Run's effective permission mode, and audited with the same `tool.requested`, `tool.started`, and `tool.completed` events as a model-origin read, carrying that origin; a file longer than one read result SHALL be read as consecutive bounded pages, each starting at the line after the last complete line collected, each page one audited read, until the file ends, the 32 KiB budget is reached, or a page returns no new line because one source line cannot fit a result, at which point collection stops and the file is cut there. An instruction import SHALL be read the same way, with system origin `instructions` and the same `read` group evaluation, paging, and audit behavior. When an import's canonical path differs from its resolved path, the system SHALL evaluate that canonical path and record and attach a derived `canonical` permission decision to the import's first page read call (the same derived-decision kind `enter_workspace` records); a rejection SHALL deny that call (requested/completed, no started) and the import. A bypass SHALL admit it and record the decision like every bypassed evaluation. A denied candidate SHALL be omitted from the bundle, SHALL NOT be named in the item text, and SHALL NOT be marked seen. A continuation page that starts past the end of the file ends collection; any other read that fails SHALL be omitted the same way. Loading SHALL NOT require `enter_workspace` and SHALL NOT depend on the `enter_workspace` group; it SHALL happen only when `read` is in `tools.allowed` and either a native executor is configured for a host-path trigger or a Knowledge root is configured for a `kb://` trigger. System-origin events SHALL NOT appear as assistant tool parts, whether observed live, reconstructed from the event log, or recovered after a worker restart.

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

#### Scenario: Canonical admission is bypassed for an import

- **WHEN** `/repo/AGENTS.md` imports `/repo/link.md`, its resolved path is allowed, its canonical target is `/outside/doc.md`, and permission mode bypasses evaluation
- **THEN** the import's first page read records a derived `canonical` decision as bypassed and admits the import
- **AND** the import is read without a permission denial

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

Each loaded instruction body SHALL expand markers as whole-file imports in its store. Host importers SHALL resolve relative targets from their directory and absolute targets; `~/` targets SHALL remain literal. Knowledge importers SHALL resolve only relative targets within their own Space; escaping targets SHALL remain literal. Import selectors SHALL NOT be interpreted. Schemed, cross-store, and admitted missing or admitted non-regular targets SHALL remain literal and SHALL load nothing.

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

#### Scenario: A home-relative instruction import stays literal

- **WHEN** `/repo/AGENTS.md` contains `@~/prefs.md`
- **THEN** the marker remains literal
- **AND** no server-resolved home path reaches labels or metadata, no probe runs, and no audit event is recorded

#### Scenario: Instruction imports load whole files

- **WHEN** `/repo/AGENTS.md` contains `[doc](foo/doc.md:30-35 "import")` and only `/repo/foo/doc.md` exists
- **THEN** the target `foo/doc.md:30-35` names no file and the marker remains literal
- **AND** no read or audit event is recorded

### Requirement: Instruction import targets are admitted before probing

After resolving a host or `kb://` target, the `read` group SHALL silently pre-evaluate the target without recording, before any probe. A denied target SHALL use the normal audited `read` path without probing and SHALL be reported as denied/not imported whether or not it exists. Only an admitted target SHALL be probed; an admitted missing target SHALL remain literal with no audit. Bypass admits and probes.

#### Scenario: A rejected import target hides existence

- **WHEN** the silent `read` pre-evaluation rejects an import target, whether or not its host path or Knowledge resource exists
- **THEN** the normal audited `read` path records the denial without probing the filesystem and reports the marker as denied/not imported
- **AND** the marker remains literal and the owner sees the same denied outcome in either case

### Requirement: Instruction imports are bounded and cycle-safe

Instruction imports SHALL process targets in first-occurrence order, depth-first, for at most five hops from the nearest chain file. Imported chain files SHALL restart at hop zero. Targets in the epoch seen set by canonical host or logical `kb://` key, or in an expansion's in-progress set, SHALL be skipped. Missing, non-regular, repeated, cyclic, and sixth-hop targets stay literal and unaudited; denied or failed imports SHALL NOT be marked seen and SHALL be evaluated again by a later trigger.

#### Scenario: A sixth import hop remains literal

- **WHEN** `/repo/AGENTS.md` imports `a.md`, each of `a.md` through `d.md` imports the next file, and `e.md` imports `f.md`
- **THEN** `a.md` through `e.md` load as five imports
- **AND** `@f.md` remains literal in `e.md` with no sixth file loaded

#### Scenario: An imported chain restarts hops across directories

- **WHEN** `/repo/AGENTS.md` imports `foo/doc.md`; that loads chain file `/repo/foo/AGENTS.md`, which imports `bar/1.md`; `bar/1.md` imports `2.md`, `2.md` imports `3.md`, `3.md` imports `4.md`, `4.md` imports `5.md`, and `5.md` imports `6.md`
- **THEN** `bar/1.md` through `bar/5.md` load, five hops from the chain file
- **AND** the marker for `bar/6.md` stays literal

#### Scenario: A cycle loads each file once

- **WHEN** `/repo/a.md` imports `b.md` and `/repo/b.md` imports `a.md`
- **THEN** each imported file is loaded at most once
- **AND** the second marker remains literal with no second read or audit

#### Scenario: A missing allowed import remains literal without audit

- **WHEN** `/repo/AGENTS.md` contains `@missing.md`, the silent `read` pre-evaluation admits the resolved target, and no such file exists
- **THEN** the marker remains literal
- **AND** no read and no audit event is recorded for the missing target
