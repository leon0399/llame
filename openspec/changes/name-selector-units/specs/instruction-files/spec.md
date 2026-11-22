## MODIFIED Requirements

### Requirement: A Knowledge locator loads the chain within its Space

A `read`, `edit`, or `write` whose `path` is a `kb://<spaceId>/<relative path>` locator MUST load the same candidate chains, with the same selection rules. The chains run from the root of that Space down to the touched directory, and include it. The load MUST NOT consider a directory above that Space root. Thus it never reads the `knowledge.root` directory of the operator, which holds the Spaces of every owner. It also never reads a host ancestor of that directory or another Space.

The touched directory MUST be the directory of the locator when the locator names an existing directory in that Space. Otherwise, it MUST be the parent directory of the locator path in that Space. When the Knowledge resolver refuses a candidate as a symbolic link, the load MUST NOT select it, and its chain MUST continue.

Space resolution and every candidate probe MUST run under the identity of the Run owner, through the owner-scoped Knowledge resolver. A locator can name the Space of another owner, a Space that does not exist, or a Space that is unavailable. Each of these MUST load nothing, probe nothing, and record no audit event.

The load MUST label and key every selected candidate by its logical locator `kb://<spaceId>/<relative path>`. This locator MUST have the percent-encoding that the Knowledge locator formatter gives. It MUST be the `path` of the item and its seen key. A host path MUST NOT appear in the text, payload, metadata, audit events, or owner chip of the item.

The load MUST read each selected candidate through the native `read` tool, with its `kb://` locator and bounded `:raw:L<from>-<to>` pages. These pages MUST use the canonical selector spelling. The reads MUST run under system origin `instructions`. The `read` permission group MUST evaluate them as it evaluates a host candidate.

The load MUST occur only for a locator whose Space identifier already has the canonical lower-case form that the Knowledge locator formatter gives. A locator whose Space identifier contains an upper-case letter MUST load nothing, probe nothing, and record no event. The read that the model itself asked for MUST continue normally, under the spelling that the model wrote.

Grouping, labels, seen keys, and every candidate page read MUST use that one canonical spelling. Thus the `read` group evaluates the injection under the same locator as a read of that candidate by the model.

A bundle with at least one Knowledge candidate MUST include the closed Knowledge untrusted-content notice of `knowledge-tools` exactly once. A bundle with only host-path candidates MUST NOT include it.

A model `kb://` trigger MUST NOT cause an accepted-turn load. A Workspace entry MUST NOT cause an accepted-turn load for a Space, because a Space has no Workspace binding. An admitted `kb://` prompt import MUST load its Space chain on its accepted turn. A `kb://` import can name an entry that the Knowledge resolver refuses as a symbolic link. That import MUST load nothing, and its marker MUST stay literal.

One step can load candidates from host-path triggers and from `kb://` triggers. These candidates MUST resolve into at most one item. The host files MUST come first and the Knowledge files second. Each group MUST start from its broadest directory, with a base file before its local file.

#### Scenario: A read in a Space loads that Space's chain from its root

- **WHEN** the model reads `kb://<space>/notes/lore/x.md` and `<space>/CLAUDE.md` and `<space>/notes/lore/AGENTS.md` exist
- **THEN** one bundle carries `kb://<space>/CLAUDE.md` then `kb://<space>/notes/lore/AGENTS.md`
- **AND** no host path names either file

#### Scenario: A file above the Space root is never loaded

- **WHEN** the resolver finds a Space under the `knowledge.root` of the operator, and a candidate chain name also exists above the root of that Space
- **THEN** the bundle carries no file from outside the Space root

#### Scenario: Another owner's Space loads nothing

- **WHEN** a Run of one owner reads `kb://<other-owner-space>/notes/x.md`, a Space of a different owner
- **THEN** no instructions item is produced, no candidate in that Space is probed, and no event with origin `instructions` is recorded

#### Scenario: A search hit does not trigger

- **WHEN** a `knowledge_search` result names a file that holds a candidate chain name
- **THEN** no instructions item is produced for that result

#### Scenario: The bundle names logical locators only

- **WHEN** a step loads candidates from a Space
- **THEN** the item text and the `files` payload carry `kb://<spaceId>/<relative path>` values
- **AND** no host path appears in the text, the payload, the metadata, or the audit events

#### Scenario: An upper-case Space identifier is not a trigger

- **WHEN** the model calls `read("kb://<Space>/notes/x.md")`, where `<Space>` spells the identifier of a Space with upper-case letters, and that Space holds `CLAUDE.md`
- **THEN** no instructions item is produced, no candidate in that Space is probed, and no event with origin `instructions` is recorded
- **AND** the read that the model asked for still runs and returns the named file

#### Scenario: A Space bundle carries the Knowledge notice once

- **WHEN** one step loads candidates from a Space, with or without host-path candidates
- **THEN** the item includes the closed Knowledge untrusted-content notice exactly once
- **AND** a bundle of host-path candidates only carries no such notice

#### Scenario: An admitted Knowledge prompt import is the accepted-turn exception

- **WHEN** an unbound Chat admits a `kb://<space>/notes/lore/x.md` prompt import and `<space>/CLAUDE.md` and `<space>/notes/lore/AGENTS.md` exist
- **THEN** the Space chain loads on that accepted turn
- **AND** a model `kb://` trigger or a Workspace entry does not produce an accepted-turn load for that Space

#### Scenario: A candidate page uses the canonical spelling

- **WHEN** a step loads `kb://<space>/CLAUDE.md`
- **THEN** its first page read is `kb://<space>/CLAUDE.md:raw:L1-2000`
- **AND** the `read` group evaluates that exact text
