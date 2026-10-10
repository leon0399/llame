## MODIFIED Requirements

### Requirement: Entry, native file tools, and accepted turns are the only triggers

A successful `enter_workspace` that establishes or switches the binding SHALL trigger a load for the canonical root, effective from the next model step of the same Run; a same-root re-entry SHALL NOT. Each native `read`, `edit`, or `write` whose `path` resolves to a local host filesystem path SHALL trigger a load for that path's directory, effective from the next model step, regardless of the call's own outcome and regardless of any read selector or representation suffix on the path; a denied call SHALL NOT trigger a load. Each native `read`, `edit`, or `write` whose `path` is a `kb://` locator SHALL trigger a load for the touched directory within that Space, effective from the next model step, under the Knowledge-locator requirement. `bash`, `knowledge_search`, `skill://`, `http://`, `https://`, and any other locator SHALL NOT trigger a load. A model-origin read or a prompt import whose target is itself a candidate file in its directory SHALL neither load that file nor mark it seen; other candidates in the chain are unaffected. An instruction import that is loaded SHALL trigger its own host or Knowledge directory chain in the same bundle, depth-first from its importer and sharing the epoch seen set. At each accepted user turn on a Chat with a live Workspace binding, after the attempt's binding re-check and not on a detaching attempt, accepted-turn preparation SHALL stage a load for the canonical root before the first model request when any file of that chain is not in effective context. The resulting accepted-turn bundle SHALL be stored on the triggering user message in the transaction that dispatches the attempt's first model request, and that request SHALL carry exactly the stored bundle; the bundle SHALL stay on the user message whatever the Run's outcome. A retry of the same Run SHALL reuse a bundle an earlier attempt stored, unchanged as stored text, and its own accepted-turn load SHALL omit every file that bundle names because those files are already seen; a retry of a Run whose earlier attempts dispatched no model request SHALL prepare the load as a first attempt does. At that accepted turn, each admitted host-path or `kb://` prompt import recorded in the persisted `prompt-imports` item SHALL trigger a load for that path's directory regardless of Workspace binding and of its read outcome after admission. Prompt-import triggers SHALL be gated exactly like in-Run triggers: a host-path trigger needs `read` allowlisted and a native executor, and a `kb://` trigger needs `read` allowlisted and a Knowledge root; denied, missing, web, and `skill://` prompt imports SHALL NOT trigger a load. The persisted item SHALL record, for each attempted target, whether it was admitted and its resolved absolute host path or canonical `kb://` locator, so accepted-turn preparation rebuilds these triggers from the item. Effective context for that decision SHALL be the history the model will read: when a checkpoint is published before that first model request, the decision is made against the rebuilt effective history the checkpoint leaves, and a file that checkpoint absorbed counts as not seen. A Chat without a binding SHALL receive no accepted-turn load. That no-binding rule applies to the root load only; prompt-import triggers are an explicit exception and do not require a Workspace binding. All triggers pending at one model step, or at one accepted turn, SHALL be resolved together into at most one item, and a step whose every candidate is already seen SHALL produce no item.
A detaching attempt SHALL perform no new prompt imports and SHALL stage no prompt-import instruction triggers, and SHALL keep an accepted-turn bundle an earlier attempt of the Run stored, replaying it unchanged as stored text without removing it; a non-detaching retry SHALL rebuild prompt-import triggers from the persisted resolved paths.

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

#### Scenario: The accepted-turn bundle is stored with the first model request

- **WHEN** a Chat bound to `/home/u/repo` accepts a turn whose root chain is not in effective context and the attempt dispatches its first model request
- **THEN** the root-chain bundle is on the triggering user message when that request is dispatched
- **AND** the bundle stays on the user message when the Run then fails, is cancelled, or expires

#### Scenario: A retry reuses the stored accepted-turn bundle

- **WHEN** an attempt stored an accepted-turn bundle naming `/home/u/repo/AGENTS.md`, dispatched its first model request, and failed, and a retry of the same Run starts
- **THEN** the retry's request carries the stored bundle unchanged as stored text
- **AND** the retry's accepted-turn load produces no second item for `/home/u/repo/AGENTS.md`

#### Scenario: A detaching retry keeps the stored accepted-turn bundle

- **WHEN** an earlier attempt stored an accepted-turn bundle and a retry detaches from the Workspace binding
- **THEN** the bundle remains on the user message and replays unchanged as stored text, without being re-read or removed
- **AND** the detaching retry stages no new accepted-turn load

### Requirement: A file is loaded once per compaction epoch, derived from effective history

The seen set SHALL be the set of file identities named in the `files` payload of `instructions` items in the Chat's effective history — the rows after the active checkpoint's absorbed-through sequence, together with items staged or emitted by the current attempt — and SHALL NOT be stored in a Chat column or any other durable state. Denied, failed, and empty candidates are not in that payload and are therefore not seen. An item stored in history SHALL stay there, and its files seen, whatever the outcome of the attempt that stored it; only a retry of the same Run, which replaces that attempt's reply, SHALL remove the in-Run items stored on the replaced reply, together with that attempt's output. A file whose identity is in the seen set SHALL be omitted from a bundle. No file identity SHALL cross a checkpoint, so a file whose item was absorbed by a checkpoint is no longer seen and reloads on its next trigger. A checkpoint published before a Run's first model request SHALL reset that attempt's seen state to the rebuilt effective history, and the accepted-turn root load SHALL be decided against that rebuilt history. Path identity SHALL be the canonical (`realpath`) path of the loaded file, so that two spellings or a symbolic link and its target count as one file; a candidate loaded from a Space SHALL instead be keyed by its logical `kb://` locator, which is also what the model's own read of that candidate is compared against. An instruction import SHALL use the canonical host path or logical `kb://` locator as its identity in the same `files` payload, and an import whose identity is already in the seen set SHALL be skipped with its marker left literal. An edit to an already-loaded file SHALL NOT re-announce it within the epoch.

#### Scenario: Second touch in the same epoch is silent

- **WHEN** `apps/api/AGENTS.md` was loaded earlier in the epoch and the model reads another file under `apps/api`
- **THEN** no instructions item is produced for that touch

#### Scenario: Forked Chat inherits the seen set through its copied history

- **WHEN** an owner forks a Chat whose effective history carries instructions items
- **THEN** the fork's first trigger omits the files those items name
- **AND** no Chat column is consulted

#### Scenario: A failed attempt's bundle stays seen

- **WHEN** an attempt emits an accepted-turn or in-Run bundle and then fails, is cancelled, or its worker crashes, and the Run ends without another attempt
- **THEN** the bundle remains in history with that attempt's output
- **AND** the next turn's trigger loads nothing for the files it names
- **AND** when a retry of the same Run follows instead, the accepted-turn bundle still remains and the retry's trigger loads nothing for its files

#### Scenario: Failed attempt leaves nothing seen

- **WHEN** an attempt emits an in-Run bundle and then fails, and a retry of the same Run replaces that attempt's reply
- **THEN** the in-Run bundle is removed with that attempt's output
- **AND** the retry's first trigger for the same directory loads those files again

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
