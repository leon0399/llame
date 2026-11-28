## ADDED Requirements

### Requirement: Enumeration skips fixed infrastructure directories

This capability governs every tree enumeration that the Machine daemon
performs: a `grep` walk and a directory listing, on the host Machine and on a
remote Machine. A tree enumeration MUST NOT enter a directory named `.git`,
`.jj`, `.hg`, `.svn`, or `node_modules`. The rule applies by leaf name, at any depth, to a
directory or a file. The enumeration MUST NOT open an entry that this rule
skips. An ignore rule MUST NOT decide an entry that the fixed set names. Each
surface keeps its own rendering of a skipped entry.

#### Scenario: A jj repository is not entered

- **WHEN** a walked tree holds a `.jj` directory with Markdown files below it
- **THEN** the enumeration examines no entry below `.jj`

#### Scenario: A nested repository is not entered

- **WHEN** a walked tree holds `notes/repo/.git` below the requested root
- **THEN** the enumeration examines no entry below `notes/repo/.git`

#### Scenario: A git worktree pointer file is not opened

- **WHEN** a walked tree holds a `.git` file that contains a `gitdir:` pointer
- **THEN** the enumeration does not read that file

#### Scenario: A vendored dependency tree is not entered

- **WHEN** a walked tree holds `node_modules` with Markdown files below it
- **THEN** the enumeration examines no entry below `node_modules`

### Requirement: An explicitly addressed path overrides the walk policy

A read, a `grep` scope, or a directory listing that names one exact path MUST
reach that path. This holds when the walk policy excludes it. An enumeration
MUST apply the walk policy only to entries that it reaches by traversal. It
MUST NOT apply the policy to the path that a caller names.

#### Scenario: An explicitly named gitignored file is searched

- **WHEN** a scope is `/home/u/repo/dist/app.js` and `dist/` is gitignored
- **THEN** the tool searches that file

#### Scenario: An explicitly requested git directory is listed

- **WHEN** a read targets `/home/u/repo/.git/`
- **THEN** the listing shows the entries of that directory

#### Scenario: An explicitly named infrastructure tree is searched

- **WHEN** a scope is `machine://build/srv/app/.jj`
- **THEN** the walk enters that directory and searches its files

### Requirement: Ignore files from the requested root and above it apply

A tree enumeration MUST apply `.ignore` files from its start directory down to
each candidate entry. It MUST apply `.gitignore` files in the same way, under
the repository limit of the next requirement. On a Machine, the enumeration
starts at the registered root that holds the requested path. A deeper ignore
file outranks a shallower one. In one directory, `.ignore` outranks
`.gitignore`. A search MUST NOT take either file as a candidate. A listing
MUST NOT omit either file only because it is an ignore file.

#### Scenario: A rule at the repository root applies to a narrower scope

- **WHEN** `/home/u` is the registered root, `/home/u/repo/.git` exists,
  `/home/u/repo/.gitignore` names `dist/`, and a scope is `/home/u/repo/apps`
- **THEN** the walk examines no file below `/home/u/repo/apps/web/dist`

#### Scenario: An ignore file outside a repository applies

- **WHEN** `/mnt/d/Projects` is the registered root,
  `/mnt/d/Projects/.ignore` names `.build-cache/`, and a scope is
  `/mnt/d/Projects/Arduino`
- **THEN** the walk examines no file below
  `/mnt/d/Projects/Arduino/libraries/.build-cache`

#### Scenario: An in-scope gitignore applies without a repository

- **WHEN** a walked tree holds no `.git` entry and its root `.gitignore` names `drafts/`
- **THEN** the enumeration examines no entry below `drafts`

#### Scenario: An ignore file is not searched

- **WHEN** `/home/u/repo/.ignore` contains a match and a scope is
  `/home/u/repo`
- **THEN** no passage names `/home/u/repo/.ignore`

### Requirement: A gitignore above the requested root applies only in its repository

The repository directory is the nearest directory at or above the requested
root that holds a `.git` entry, a directory or a file. The walk looks for it
only up to the registered root that holds the requested root. Without one
there, the registered root is the repository directory. A `.gitignore` above
the requested root MUST apply only in the repository directory or below it.
The walk MUST NOT apply a `.gitignore` above the registered root.

#### Scenario: A gitignore above the repository does not apply

- **WHEN** `/home/u` is the registered root, `/home/u/.gitignore` names `*.md`, `/home/u/repo/.git` exists, and a scope is `/home/u/repo`
- **THEN** the walk searches `/home/u/repo/README.md`

#### Scenario: A gitignore at the registered root applies without a repository

- **WHEN** `/mnt/d/Projects` is the registered root, `/mnt/d/Projects/.gitignore` names `*.md`, no `.git` exists at or above `/mnt/d/Projects/Arduino`, and that directory is the scope
- **THEN** the walk examines no `/mnt/d/Projects/Arduino/README.md`

#### Scenario: A gitignore above the registered root does not apply

- **WHEN** `/mnt/d/Projects/Arduino` is the registered root, `/mnt/d/Projects/.gitignore` names `*.md`, and that root is the scope
- **THEN** the walk searches `/mnt/d/Projects/Arduino/README.md`

#### Scenario: A Machine repository above the registered root

- **WHEN** a Machine root is `/srv/app/packages`, `.git` is at `/srv/app`, `/srv/app/packages/.gitignore` names `dist/`, and a scope is `machine://build/srv/app/packages/api`
- **THEN** the daemon examines no file below `/srv/app/packages/api/dist`

### Requirement: An ignore rule decides an entry by its own path

The requested root is the directory or file that the caller names. An ignore
rule MUST NOT exclude the requested root or a directory above it. A rule MUST
decide an entry only when its pattern matches the path of that entry. A match
on a directory above the entry MUST NOT decide it. In one ignore file, the
last rule that decides an entry wins.

#### Scenario: An explicit scope searches an ignored directory

- **WHEN** `/home/u/repo/.gitignore` names `node_modules/` and a scope is `/home/u/repo/node_modules/react`
- **THEN** the walk searches the files below that scope

#### Scenario: A glob does not override an ignore rule

- **WHEN** `/home/u/repo/.gitignore` names `node_modules/` and a scope is `/home/u/repo/**/node_modules/react/*.js`
- **THEN** the walk examines no file below `/home/u/repo/node_modules`

#### Scenario: A re-included directory keeps the other rules

- **WHEN** `/home/u/repo/.gitignore` names `build/` and `*.log`, and `/home/u/repo/src/.gitignore` names `!build/`
- **THEN** the walk enters `/home/u/repo/src/build`
- **AND** it examines no `.log` file below it

#### Scenario: A nested ignored directory below an explicit scope is excluded

- **WHEN** `/home/u/repo/.gitignore` names `node_modules/` and a scope is `/home/u/repo/node_modules/react`
- **THEN** the walk examines no file below `/home/u/repo/node_modules/react/x/node_modules`

#### Scenario: An allow list keeps its files

- **WHEN** `/home/u/repo/.gitignore` names `*`, then `!*/`, then `!src/**`
- **THEN** the walk searches `/home/u/repo/src/a/b.js`
- **AND** it examines no `/home/u/repo/lib/c.js`

#### Scenario: A negated directory keeps the rule for its files

- **WHEN** `/home/u/repo/.gitignore` names `build*` and `!build-tools/`
- **THEN** the walk enters `/home/u/repo/build-tools`
- **AND** it examines no `/home/u/repo/build-tools/build.sh`

#### Scenario: A rule that matches a file directly still excludes it

- **WHEN** `/home/u/repo/.gitignore` names `docs/**` and then `!docs/keep/`
- **THEN** the walk enters `/home/u/repo/docs/keep`
- **AND** it examines no `/home/u/repo/docs/keep/a.md`
