# instruction-files Specification

## Purpose

Loads per-directory project instruction files (`LLAME.md`, `AGENTS.md`, `CLAUDE.md` and their override and local variants) into a Chat's model-visible context when a Workspace is entered or a native file tool touches a path, once per compaction epoch, through the context rail.

## Requirements

### Requirement: Each directory contributes at most one base file and one local file

For a directory `D`, the base candidate SHALL be the first existing regular file among `LLAME.override.md`, `LLAME.md`, `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.override.md`, and `CLAUDE.md`, in that order, and the local candidate SHALL be the first existing regular file among `LLAME.local.md`, `AGENTS.local.md`, and `CLAUDE.local.md`, in that order. The two selections SHALL be independent: a directory MAY contribute a base file, a local file, both, or neither. A name earlier in a chain SHALL replace, not merge with, every later name in the same chain and directory. A candidate whose final path component is a symbolic link SHALL be followed and its target loaded; a name that resolves to a non-regular file SHALL NOT be selected and the chain continues; an empty regular file SHALL be selected and contribute nothing, so it suppresses later names. When two selected candidates in one walk resolve to the same canonical file, the first in walk order SHALL be loaded under its own selected path and the later one SHALL contribute nothing. Filename comparison SHALL be exact and case-sensitive.

#### Scenario: LLAME.md replaces AGENTS.md

- **WHEN** a directory contains `LLAME.md` and `AGENTS.md`
- **THEN** only `LLAME.md` is loaded from that directory's base chain
- **AND** `AGENTS.md` is neither loaded nor named to the model

#### Scenario: Local file loads beside the base file

- **WHEN** a directory contains `AGENTS.md` and `CLAUDE.local.md` and no other candidate
- **THEN** both are loaded, `AGENTS.md` before `CLAUDE.local.md`

#### Scenario: Override precedes its base name

- **WHEN** a directory contains `AGENTS.override.md`, `AGENTS.md`, and `LLAME.md`
- **THEN** only `LLAME.md` is loaded, because it precedes both `AGENTS` names in the chain

#### Scenario: Symlinked candidate collapses to its target

- **WHEN** `/home/u/repo/apps/api/AGENTS.md` is a symbolic link to `/home/u/repo/AGENTS.md` and a touch under `apps/api` walks both directories
- **THEN** `/home/u/repo/AGENTS.md` is loaded once under its own path and `apps/api` contributes nothing

#### Scenario: Empty placeholder suppresses later names

- **WHEN** a directory contains an empty `LLAME.md` and a non-empty `AGENTS.md`
- **THEN** neither is loaded from that directory's base chain

### Requirement: A host-path trigger loads the chain from the filesystem root down to the touched directory

An entry trigger and a native `read`, `edit`, or `write` whose `path` is a local host filesystem path SHALL each name one directory `D` on the native executor host. The load SHALL consider every directory from the filesystem root down to `D` inclusive, in that order, and SHALL include ancestors above any Workspace root or repository boundary. `D` SHALL be the canonical Workspace root for an entry trigger; for a file-tool trigger it SHALL be the projected absolute path itself when that path is an existing directory, and otherwise the parent directory of the projected absolute path, whether or not that path exists. The walk SHALL NOT descend into siblings or children of `D`. A trigger whose `path` is a `kb://` locator SHALL NOT walk the host filesystem; it SHALL follow the Knowledge-locator requirement instead.

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

### Requirement: A Knowledge locator loads the chain within its Space

A `read`, `edit`, or `write` whose `path` is a `kb://<spaceId>/<relative path>` locator SHALL load the same candidate chains, with the same selection rules, from the root of that Space down to the touched directory inclusive, and SHALL NOT consider any directory above that Space root: not the operator's `knowledge.root` directory, which holds every owner's Spaces, not a host ancestor of it, and not another Space. The touched directory SHALL be the locator's own directory when it names an existing directory in that Space, and otherwise the parent directory of the locator's path within that Space. A candidate that the Knowledge resolver refuses as a symbolic link SHALL NOT be selected and its chain SHALL continue.

Space resolution and every candidate probe SHALL run under the Run owner's identity through the owner-scoped Knowledge resolver. A locator naming another owner's Space, a Space that does not exist, and a Space that is unavailable SHALL each load nothing, probe nothing, and record no audit event.

Every selected candidate SHALL be labelled and keyed by its logical locator `kb://<spaceId>/<relative path>`, percent-encoded exactly as the Knowledge locator formatter produces it, and that logical locator SHALL be the item's `path` and its seen key; no host path SHALL appear in the item's text, payload, metadata, audit events, or owner chip. Each selected candidate SHALL be read through the native `read` tool with its `kb://` locator and bounded `:raw:<from>-<to>` pages, under system origin `instructions`, evaluated by the `read` permission group exactly as a host candidate is.

Loading SHALL occur only for a locator whose Space identifier is already the canonical lower-case form the Knowledge locator formatter produces; a locator whose Space identifier contains an upper-case letter SHALL load nothing, probe nothing, and record no event, and the model's own read of that locator SHALL proceed normally under the spelling it wrote. Grouping, labels, seen keys, and every candidate page read SHALL use that one canonical spelling, so the `read` group evaluates the injection under exactly the locator the model's own read of that candidate uses.

A bundle carrying at least one Knowledge candidate SHALL include the closed Knowledge untrusted-content notice `knowledge-tools` defines exactly once, and a bundle carrying only host-path candidates SHALL NOT include it.

A `kb://` trigger SHALL NOT produce an accepted-turn load, because a Space has no Workspace binding; its chain returns on the next touch after a compaction. Candidates loaded for one step from host-path triggers and from `kb://` triggers SHALL resolve into at most one item, with the host files first, then the Knowledge files, each group from its broadest directory and a base file before its local file.

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

### Requirement: Entry, native file tools, and accepted turns are the only triggers

A successful `enter_workspace` that establishes or switches the binding SHALL trigger a load for the canonical root, effective from the next model step of the same Run; a same-root re-entry SHALL NOT. Each native `read`, `edit`, or `write` whose `path` resolves to a local host filesystem path SHALL trigger a load for that path's directory, effective from the next model step, regardless of the call's own outcome and regardless of any read selector or representation suffix on the path; a denied call SHALL NOT trigger a load. Each native `read`, `edit`, or `write` whose `path` is a `kb://` locator SHALL trigger a load for the touched directory within that Space, effective from the next model step, under the Knowledge-locator requirement. `bash`, `knowledge_search`, `skill://`, `http://`, `https://`, and any other locator SHALL NOT trigger a load. A model-origin read whose target is itself a candidate file in its directory SHALL neither load that file nor mark it seen; other candidates in the chain are unaffected. At each accepted user turn on a Chat with a live Workspace binding, after the attempt's binding re-check and not on a detaching attempt, accepted-turn preparation SHALL stage a load for the canonical root before the first model request when any file of that chain is not in effective context. A Chat without a binding SHALL receive no accepted-turn load. All triggers pending at one model step, or at one accepted turn, SHALL be resolved together into at most one item, and a step whose every candidate is already seen SHALL produce no item.

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

- **WHEN** a Chat bound to `/home/u/repo` is compacted after its root chain was loaded and a new user turn is accepted
- **THEN** the root chain is staged before the first model request of that turn
- **AND** a Chat with no binding stages nothing

#### Scenario: Two touches in one step produce one bundle

- **WHEN** one model step reads `apps/api/a.ts` and `apps/web/b.ts`
- **THEN** the next step carries one bundle with the union of both chains in directory order, each file once

### Requirement: A file is loaded once per compaction epoch, derived from effective history

The seen set SHALL be the set of file identities named in the `files` payload of `instructions` items in the Chat's effective history — the messages after the active compaction's cutoff, together with items staged or emitted by the current attempt — and SHALL NOT be stored in a Chat column or any other durable state. Denied, failed, and empty candidates are not in that payload and are therefore not seen. A file whose identity is in the seen set SHALL be omitted from a bundle. Compaction SHALL NOT carry an in-Run instructions item into replacement history, so a file whose item was absorbed by a compaction is no longer seen and reloads on its next trigger. Transition compaction inside a Run SHALL reset the attempt's seen state to the rebuilt effective history, and the accepted-turn root load SHALL be decided against that rebuilt history. Path identity SHALL be the canonical (`realpath`) path of the loaded file, so that two spellings or a symbolic link and its target count as one file; a candidate loaded from a Space SHALL instead be keyed by its logical `kb://` locator, which is also what the model's own read of that candidate is compared against. An edit to an already-loaded file SHALL NOT re-announce it within the epoch.

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

### Requirement: Each candidate is read with system origin under the read permission group

Candidate existence and size SHALL be probed without a permission decision and without an audit event — on the native executor for a host-path candidate and through the Run owner's Knowledge resolver for a `kb://` candidate — and the probe SHALL reveal nothing to the model; only a candidate that exists and is then denied by the `read` group is disclosed, to the owner alone, through the audit event and, when the same step loads another file, the chip. Each existing candidate SHALL then be read through the native `read` tool with system origin `instructions`, evaluated by the `read` permission group under the Run's effective permission mode, and audited with the same `tool.requested`, `tool.started`, and `tool.completed` events as a model-origin read, carrying that origin; a file longer than one read result SHALL be read as consecutive bounded pages, each starting at the line after the last complete line collected, each page one audited read, until the file ends, the 32 KiB budget is reached, or a page returns no new line because one source line cannot fit a result, at which point collection stops and the file is cut there. A denied candidate SHALL be omitted from the bundle, SHALL NOT be named in the item text, and SHALL NOT be marked seen. A continuation page that starts past the end of the file ends collection; any other read that fails SHALL be omitted the same way. Loading SHALL NOT require `enter_workspace` and SHALL NOT depend on the `enter_workspace` group; it SHALL happen only when `read` is in `tools.allowed` and either a native executor is configured for a host-path trigger or a Knowledge root is configured for a `kb://` trigger. System-origin events SHALL NOT appear as assistant tool parts, whether observed live, reconstructed from the event log, or recovered after a worker restart.

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

### Requirement: A bundle is one persisted-literal notice with bounded file bodies

Each model step, or accepted turn, whose pending triggers load at least one file SHALL produce exactly one rail-resident `instructions` item with form `notice` rendered from a packaged template. The item SHALL name each loaded file in a `<file path="…">` block carrying the identifier at which the candidate was selected in the walk — the absolute host path for a host-path candidate, the logical `kb://` locator for a Knowledge candidate — in directory order from broadest to most specific with a directory's base file before its local file, host-path candidates before Knowledge candidates when one step loads both; the payload SHALL additionally record each file's canonical path, or its logical locator for a Knowledge candidate, as its seen key. It SHALL state once that each file applies to work under its own directory and that a deeper file takes precedence over a broader one where they conflict, and SHALL carry the precedence statement `context-injection` requires for third-party content, whose wording SHALL cover both repository and Knowledge content rather than repository content alone. Each file body SHALL be neutralized with the reserved-delimiter rules before rendering. A file larger than 32 KiB SHALL be cut at 32 KiB on a UTF-8 character boundary and followed by one line naming the path and the number of bytes omitted, taken from the probed size; there SHALL be no aggregate cap per item. The item SHALL NOT name denied or missing candidates and SHALL NOT include line-number prefixes. Its metadata SHALL record the loaded, truncated, and denied paths privately for owner display; replay SHALL use only the stored text.

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

### Requirement: Owners see which files were loaded, truncated, or denied

The owner transcript SHALL show, on the message that carries an instructions item, a chip listing the loaded paths and marking truncated and denied ones from the item's private metadata. The Run context-item record SHALL copy the item's model-visible text only. Non-owners, public shares, transcript exports, and search projections SHALL expose neither the text nor the metadata.

#### Scenario: Denied file is visible to the owner only

- **WHEN** a bundle omitted `/srv/AGENTS.md` because the `read` group rejected it
- **THEN** the owner's chip marks `/srv/AGENTS.md` as denied
- **AND** the model-visible text and the Run record do not mention it

#### Scenario: Public share hides instruction items

- **WHEN** a Chat carrying instructions items is shared publicly
- **THEN** the share response contains no instructions item text or metadata
