## MODIFIED Requirements

### Requirement: Excluded directories are reported

The walk MUST record each directory that an ignore rule excludes. It MUST NOT
record a directory that the fixed set names, because the fixed set decides
first and stays silent. It MUST NOT record a directory below an excluded
directory, or an excluded file. When the `read` group admits at least one
recorded locator, the result MUST carry `ignored`. `ignored.count` MUST count
the admitted locators. `ignored.locators` MUST hold the first five of them in
canonical order.

#### Scenario: The model learns which directory to scope

- **WHEN** a search over `/home/u/repo` finds no match and `vendor/` excluded `/home/u/repo/vendor`
- **THEN** `ignored.locators` holds `/home/u/repo/vendor`
- **AND** a later scope of `/home/u/repo/vendor` searches it

#### Scenario: Nested excluded directories are not repeated

- **WHEN** `vendor/` excluded `/home/u/repo/vendor`, and that directory holds another `vendor`
- **THEN** `ignored.count` counts one directory

#### Scenario: A resumed page does not repeat earlier exclusions

- **WHEN** a Machine scope answers in two `fs.grep` responses, and the first response excluded `/srv/app/vendor`
- **THEN** the result counts `/srv/app/vendor` once

#### Scenario: A fixed-set directory is never reported

- **WHEN** `/home/u/repo/.gitignore` names `node_modules/` and a scope is `/home/u/repo/**`
- **THEN** `ignored` neither counts nor names `/home/u/repo/node_modules`
- **AND** the walk examines no file below `/home/u/repo/node_modules`

### Requirement: A reported directory locator is a valid scope

Each locator in `ignored.locators` MUST be a grep scope that names that one
directory. The tool MUST spell a literal `%`, `*`, `?`, `[`, `]`, `{`, or `}`
in it as `%25`, `%2A`, `%3F`, `%5B`, `%5D`, `%7B`, or `%7D`. These seven
spellings MUST name the literal character in the path part of every scope. The
tool MUST NOT refuse `%5B`, `%5D`, `%7B`, or `%7D` as glob operators.

#### Scenario: A reported directory with brackets can be scoped

- **WHEN** `vendor/` excluded `/home/u/repo/app/[id]/vendor`
- **THEN** `ignored.locators` holds `/home/u/repo/app/%5Bid%5D/vendor`
- **AND** a later scope of that locator searches that directory

#### Scenario: A reported directory with a percent sign can be scoped

- **WHEN** `vendor/` excluded `/home/u/repo/100%41/vendor`
- **THEN** `ignored.locators` holds `/home/u/repo/100%2541/vendor`
- **AND** a later scope of that locator searches `/home/u/repo/100%41/vendor`

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

**Reason**: The requirement is written in grep's scope vocabulary, but every
enumeration surface applies the same rule, so one capability owns it.

**Migration**: The requirement continues in `walk-policy`, renamed "Ignore
files from the requested root and above it apply", with the same scenarios and
semantics. `grep-tool` binds to it through the MODIFIED walk requirement.

### Requirement: A gitignore above the scope applies only in its repository

**Reason**: The repository limit governs every enumeration surface, not only a
grep scope, so one capability owns it.

**Migration**: The requirement continues in `walk-policy`, renamed "A gitignore
above the requested root applies only in its repository", with the same
scenarios and semantics.

### Requirement: An ignore rule decides an entry by its own path

**Reason**: The decision rule governs every enumeration surface, not only a
grep scope, so one capability owns it.

**Migration**: The requirement continues in `walk-policy` under the same name,
with the same scenarios and semantics, restated for the requested root.
