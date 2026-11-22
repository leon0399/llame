## MODIFIED Requirements

### Requirement: Only a bound Chat has observed git state

The system MUST observe git state only for a Chat with a Workspace binding. The
observation MUST use the canonical Workspace root and its executor. An unbound
Chat MUST get no `git` item and no git call.

#### Scenario: An unbound Chat gets no git state

- **WHEN** a Chat with no Workspace binding starts a Run
- **THEN** the Run carries no `git` item
- **AND** no git call starts

#### Scenario: A bound Chat gets git state

- **WHEN** a Chat is bound to `machine://devl/home/dev/src/llame` and starts its first Run
- **THEN** the first model request carries one `git` item for that root

### Requirement: The git entry is found without a git process

The system MUST find the git entry before any git process starts. The git entry
MUST be the nearest `.git` directory or `.git` file at or above the root, inside
the registered root. When no entry exists inside the registered root, the result
MUST be "no repository inside the registered root".

#### Scenario: A subdirectory root finds the repository entry

- **WHEN** the registered root is `/home/dev/src/mono`, the root is
  `/home/dev/src/mono/apps/api`, and `/home/dev/src/mono/.git` exists
- **THEN** the git entry is `/home/dev/src/mono/.git`

#### Scenario: A linked worktree uses its own `.git` file

- **WHEN** the root is a linked worktree whose `.git` is a file
- **THEN** the git entry is that `.git` file

#### Scenario: A plain folder is not a repository

- **WHEN** no `.git` entry exists at or above a Workspace root inside its
  registered root
- **THEN** the result is "no repository inside the registered root" and no git
  process starts

### Requirement: Absence lines are fixed messages

When the system cannot observe git state, it MUST tell one fixed line:
"git state unavailable:" and one reason from the closed list of the next
requirement.

#### Scenario: An offline Machine is reported

- **WHEN** the Workspace Machine is offline at Run start
- **THEN** the observation gives "git state unavailable: Machine unavailable"

#### Scenario: An outdated daemon is reported

- **WHEN** the Machine daemon does not list `git.state`
- **THEN** the observation gives "git state unavailable: Machine daemon update required"

#### Scenario: A git failure is reported without its error text

- **WHEN** git fails with a dubious ownership error
- **THEN** the observation gives "git state unavailable: git failed"
