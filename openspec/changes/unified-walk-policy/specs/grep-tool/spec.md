## MODIFIED Requirements

### Requirement: Walk order and links are defined per scheme

The walk MUST visit each directory depth-first. In one directory, the walk
MUST order entries by name in byte order. The walk MUST visit a file before it
enters a directory of a later name. This traversal order is the canonical
order of the call.

A host, Machine, or Knowledge walk MUST NOT follow a symbolic link. A skill
walk MUST follow the agent-skills link semantics, under the same bounds and
the same call deadline. A skill walk MUST NOT enter a directory whose
canonical identity is already on the current path. It MUST count such a
directory as a `link` skip. It MUST also count a link that the operating system
reports as a loop as a `link` skip.

A host, Machine, or Knowledge walk MUST include hidden entries. It MUST NOT
enter a fixed infrastructure directory, as the walk policy states. It MUST
apply the ignore files that the walk policy defines. This includes a Knowledge
walk over its Space. A Knowledge walk MUST keep the Knowledge filesystem rules.
It MUST refuse a symbolic link at every component, and the path MUST stay in
the resolved Space. A scope that names one exact file MUST search that file, as
the walk policy states.

#### Scenario: gitignored directory is not entered

- **WHEN** `/home/u/repo/.gitignore` names `node_modules/` and a scope is `/home/u/repo/**`
- **THEN** the walk examines no file below `node_modules`

#### Scenario: Explicit gitignored file is searched

- **WHEN** a scope is `/home/u/repo/dist/app.js` and `dist/` is gitignored
- **THEN** the tool searches that file

#### Scenario: The Git directory is never entered

- **WHEN** a scope is `/home/u/repo/**` and `.git/config` contains a match
- **THEN** no passage names `.git/config`

#### Scenario: The jj directory is never entered

- **WHEN** a scope is `kb://<space>` and `.jj/repo/hidden.md` contains a match
- **THEN** no passage names `.jj/repo/hidden.md`

#### Scenario: A Knowledge scope applies the ignore files of its Space

- **WHEN** a scope is `kb://<space>`, the Space holds `.gitignore` naming
  `drafts/`, and `.jj` is absent from the Space
- **THEN** the walk examines no file below `drafts`

#### Scenario: Hidden file is searched

- **WHEN** a scope is `/home/u/repo/**` and `.editorconfig` contains a match
- **THEN** a passage names `.editorconfig`

#### Scenario: Host link is not followed

- **WHEN** `/home/u/repo/link` is a symbolic link to `/etc` and a scope is `/home/u/repo/**`
- **THEN** the walk examines no file below `/etc`

#### Scenario: Skill link loop is skipped

- **WHEN** a package holds `loop -> .`
- **THEN** the walk does not enter `loop`
- **AND** the tool searches the entries after `loop` in the package

#### Scenario: Skill package link is followed

- **WHEN** a skill source holds a child link to a package directory
- **THEN** a bare `skill://` scope searches that package

## REMOVED Requirements

### Requirement: Ignore files from the scope and above it apply

Moved to `walk-policy` as "Ignore files from the requested root and above it
apply".

### Requirement: A gitignore above the scope applies only in its repository

Moved to `walk-policy` as "A gitignore above the requested root applies only
in its repository".

### Requirement: An ignore rule decides an entry by its own path

Moved to `walk-policy` under the same name.
