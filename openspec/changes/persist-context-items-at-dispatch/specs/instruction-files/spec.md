## MODIFIED Requirements

### Requirement: A file is loaded once per compaction epoch, derived from effective history

The seen set SHALL be the set of file identities named in the `files` payload of `instructions` items in the Chat's effective history — the rows after the active checkpoint's absorbed-through sequence, together with items staged or emitted by the current attempt — and SHALL NOT be stored in a Chat column or any other durable state. Denied, failed, and empty candidates are not in that payload and are therefore not seen. A file whose identity is in the seen set SHALL be omitted from a bundle. No file identity SHALL cross a checkpoint, so a file whose item was absorbed by a checkpoint is no longer seen and reloads on its next trigger. A checkpoint published before a Run's first model request SHALL reset that attempt's seen state to the rebuilt effective history, and the accepted-turn root load SHALL be decided against that rebuilt history. Path identity SHALL be the canonical (`realpath`) path of the loaded file, so that two spellings or a symbolic link and its target count as one file; a candidate loaded from a Space SHALL instead be keyed by its logical `kb://` locator, which is also what the model's own read of that candidate is compared against. An instruction import SHALL use the canonical host path or logical `kb://` locator as its identity in the same `files` payload, and an import whose identity is already in the seen set SHALL be skipped with its marker left literal. An edit to an already-loaded file SHALL NOT re-announce it within the epoch. An `instructions` item a Run dispatched SHALL remain in effective history whatever that Run's outcome; the in-Run items of a superseded attempt SHALL NOT.

#### Scenario: Second touch in the same epoch is silent

- **WHEN** `apps/api/AGENTS.md` was loaded earlier in the epoch and the model reads another file under `apps/api`
- **THEN** no instructions item is produced for that touch

#### Scenario: Forked Chat inherits the seen set through its copied history

- **WHEN** an owner forks a Chat whose effective history carries instructions items
- **THEN** the fork's first trigger omits the files those items name
- **AND** no Chat column is consulted

#### Scenario: Failed attempt leaves nothing seen

- **WHEN** an attempt emits an in-Run bundle and then fails, and a retry of the same Run supersedes it
- **THEN** the retry attempt's first trigger loads the same files again

#### Scenario: Failed Run leaves its bundle seen

- **WHEN** a Run emits an in-Run bundle and then fails, is cancelled, expires, or ends with an unknown outcome
- **THEN** the next Run's first trigger omits the files that bundle named
- **AND** an accepted-turn bundle that Run dispatched is likewise seen

#### Scenario: Symlink and target are one file

- **WHEN** `/home/u/repo/apps/api/AGENTS.md` is a symbolic link to `/home/u/repo/AGENTS.md` and the target was loaded by an earlier trigger
- **THEN** a later touch under `apps/api` produces nothing for `/home/u/repo/apps/api/AGENTS.md`

#### Scenario: An already-seen import stays literal

- **WHEN** an instruction bundle already names `/repo/foo/doc.md` and a later marker resolves to that same canonical path
- **THEN** the later import is skipped
- **AND** its marker remains literal and no second file block is added

### Requirement: Owners see which files were loaded, truncated, or denied

The owner transcript SHALL show, on the message that carries an instructions item, a chip listing the loaded paths and marking truncated and denied ones from the item's private metadata. Imported paths SHALL appear nested under their importers, and denied imports SHALL be marked denied. Non-owners, public shares, transcript exports, and search projections SHALL expose neither the text nor the metadata.

#### Scenario: Denied file is visible to the owner only

- **WHEN** a bundle omitted `/srv/AGENTS.md` because the `read` group rejected it
- **THEN** the owner's chip marks `/srv/AGENTS.md` as denied
- **AND** the model-visible text does not mention it

#### Scenario: Public share hides instruction items

- **WHEN** a Chat carrying instructions items is shared publicly
- **THEN** the share response contains no instructions item text or metadata

#### Scenario: Owner chip nests imported files and marks denial

- **WHEN** a bundle loads `/repo/AGENTS.md`, imports `/repo/foo/doc.md`, and denies imported `/repo/private.md`
- **THEN** the owner's chip shows imported paths beneath their importer and marks `/repo/private.md` as denied
- **AND** a non-owner sees neither the chip metadata nor the denied path

#### Scenario: A failed Run's chip stays visible

- **WHEN** a Run whose user message carries an instructions item fails after its first model request
- **THEN** the owner's chip still lists that item's loaded, truncated, and denied paths
