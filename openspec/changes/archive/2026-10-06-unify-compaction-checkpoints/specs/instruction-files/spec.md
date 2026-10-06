# Spec Delta

## MODIFIED Requirements

### Requirement: A file is loaded once per compaction epoch, derived from effective history

The seen set SHALL be the set of file identities named in the `files` payload of `instructions` items in the Chat's effective history — the rows after the active checkpoint's absorbed-through sequence, together with items staged or emitted by the current attempt — and SHALL NOT be stored in a Chat column or any other durable state. Denied, failed, and empty candidates are not in that payload and are therefore not seen. A file whose identity is in the seen set SHALL be omitted from a bundle. No file identity SHALL cross a checkpoint, so a file whose item was absorbed by a checkpoint is no longer seen and reloads on its next trigger. A checkpoint published before a Run's first model request SHALL reset that attempt's seen state to the rebuilt effective history, and the accepted-turn root load SHALL be decided against that rebuilt history. Path identity SHALL be the canonical (`realpath`) path of the loaded file, so that two spellings or a symbolic link and its target count as one file; a candidate loaded from a Space SHALL instead be keyed by its logical `kb://` locator, which is also what the model's own read of that candidate is compared against. An edit to an already-loaded file SHALL NOT re-announce it within the epoch.

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

### Requirement: Entry, native file tools, and accepted turns are the only triggers

A successful `enter_workspace` that establishes or switches the binding SHALL trigger a load for the canonical root, effective from the next model step of the same Run; a same-root re-entry SHALL NOT. Each native `read`, `edit`, or `write` whose `path` resolves to a local host filesystem path SHALL trigger a load for that path's directory, effective from the next model step, regardless of the call's own outcome and regardless of any read selector or representation suffix on the path; a denied call SHALL NOT trigger a load. Each native `read`, `edit`, or `write` whose `path` is a `kb://` locator SHALL trigger a load for the touched directory within that Space, effective from the next model step, under the Knowledge-locator requirement. `bash`, `knowledge_search`, `skill://`, `http://`, `https://`, and any other locator SHALL NOT trigger a load. A model-origin read whose target is itself a candidate file in its directory SHALL neither load that file nor mark it seen; other candidates in the chain are unaffected. At each accepted user turn on a Chat with a live Workspace binding, after the attempt's binding re-check and not on a detaching attempt, accepted-turn preparation SHALL stage a load for the canonical root before the first model request when any file of that chain is not in effective context. Effective context for that decision SHALL be the history the model will read: when a checkpoint is published before that first model request, the decision is made against the rebuilt effective history the checkpoint leaves, and a file that checkpoint absorbed counts as not seen. A Chat without a binding SHALL receive no accepted-turn load. All triggers pending at one model step, or at one accepted turn, SHALL be resolved together into at most one item, and a step whose every candidate is already seen SHALL produce no item.

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
