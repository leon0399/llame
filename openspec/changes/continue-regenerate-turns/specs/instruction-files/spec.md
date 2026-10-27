## MODIFIED Requirements

### Requirement: A file is loaded once per compaction epoch, derived from effective history

The seen set MUST be the set of file identities that the `files` payload of `instructions` items
names in the Chat's effective history. Effective history has three sources. These are the rows
after the absorbed-through sequence of the active checkpoint, and the kept parts of a Continue Run
from `turn-actions`. The third is the items that the current attempt stages or emits. The system
MUST NOT store the seen set in a Chat
column or in any other durable state. That payload does not name denied, failed, and empty
candidates, so they are not seen. An item stored in history MUST stay there, and its files stay
seen, whatever the outcome of the attempt that stored it. Only two dispatch transactions remove
the in-Run items of an earlier attempt's reply, together with that attempt's output. The first is
the dispatch of a retry of the same Run, which resets the reply. The second is the dispatch of a
follow-up Run, which replaces the reply. A Continue Run puts back the in-Run items of its kept
parts. A retry and a follow-up Run read history only through the triggering user message. Thus
removed in-Run items are not in their seen set. A retry or follow-up Run that fails before its own
dispatch leaves them in place. A bundle MUST omit a file whose identity is in the seen set. No
file identity MUST cross a checkpoint. Thus a file whose item a checkpoint absorbed is no longer
seen, and it loads again on its next trigger. A checkpoint published before the first model
request of a Run MUST reset the seen state of that attempt to the rebuilt effective history. The
accepted-turn root load MUST use that rebuilt history. Path identity MUST be the canonical
(`realpath`) path of the loaded file. Thus two spellings, or a symbolic link and its target, count
as one file. A candidate loaded from a Space MUST use its logical `kb://` locator as its identity.
The system compares the model's own read of that candidate with that locator. An instruction
import MUST use the canonical host path or the logical `kb://` locator as its identity in the
same `files` payload. The system MUST skip an import whose identity is already in the seen set
and leave its marker literal. An edit to a file that already loaded MUST NOT announce it again in
the epoch.

#### Scenario: Second touch in the same epoch is silent

- **WHEN** `apps/api/AGENTS.md` loaded earlier in the epoch, and the model reads another file under `apps/api`
- **THEN** that touch makes no instructions item

#### Scenario: Forked Chat inherits the seen set through its copied history

- **WHEN** an owner forks a Chat whose effective history holds instructions items
- **THEN** the first trigger of the fork omits the files that those items name
- **AND** the system reads no Chat column for this

#### Scenario: A failed attempt's bundle stays seen

- **WHEN** an attempt emits an accepted-turn or in-Run bundle and then fails, is cancelled, or its worker crashes, and the Run ends with no other attempt
- **THEN** the bundle stays in history with the output of that attempt
- **AND** the trigger of the next turn loads nothing for the files that it names
- **AND** when a retry of the same Run follows instead, the accepted-turn bundle stays in place unchanged
- **AND** the trigger of the retry loads nothing for its files

#### Scenario: Failed attempt leaves nothing seen

- **WHEN** an attempt emits an in-Run bundle and then fails, and a retry of the same Run dispatches its first model request
- **THEN** the dispatch transaction of the retry resets the reply
- **AND** it removes the in-Run bundle of the replaced attempt with the output of that attempt
- **AND** the retry reads history only through the triggering user message, so it loads those files again on its first trigger for the same directory

#### Scenario: A Continue Run keeps the bundles of its kept steps

- **WHEN** a `failed` reply holds an in-Run bundle for `apps/api/AGENTS.md` after its first settled tool call, and the owner continues the turn
- **THEN** the Continue Run counts `apps/api/AGENTS.md` as seen
- **AND** a read under `apps/api` in the Continue Run makes no instructions item

#### Scenario: Symlink and target are one file

- **WHEN** `/home/u/repo/apps/api/AGENTS.md` is a symbolic link to `/home/u/repo/AGENTS.md`, and an earlier trigger loaded the target
- **THEN** a later touch under `apps/api` makes nothing for `/home/u/repo/apps/api/AGENTS.md`

#### Scenario: An already-seen import stays literal

- **WHEN** an instruction bundle already names `/repo/foo/doc.md`, and a later marker resolves to that canonical path
- **THEN** the system skips the later import
- **AND** its marker stays literal, and no second file block is added
