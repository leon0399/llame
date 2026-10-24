## ADDED Requirements

### Requirement: A project links repositories with an alias, a primary, and an isolation policy

Each project MUST store zero or more links to repositories of its owner. A link
MUST carry an alias, a primary flag, and an isolation policy. The isolation
policy MUST be `inherit`, `always_worktree`, or `never`, and MUST default to
`inherit`. Chat creation MUST obey the policy of the link it resolves. A project
MUST have no more than one primary link. The owner MUST link, unlink, and change
a link under `/api/v1/projects/:id/repositories`.

#### Scenario: The owner links a repository

- **WHEN** the owner links a repository to a project with an alias
- **THEN** the project lists that repository under the alias
- **AND** the isolation policy of the link is `inherit`

#### Scenario: The owner changes a link

- **WHEN** the owner changes the alias, the primary flag, or the isolation of a
  link
- **THEN** the project lists the repository with the new values

#### Scenario: The owner unlinks a repository

- **WHEN** the owner unlinks a repository from a project
- **THEN** the project no longer lists that repository
- **AND** the repository and its checkouts remain

#### Scenario: A project links no repository

- **WHEN** a project has no linked repository
- **THEN** the project stays usable and its chats can start with no location

#### Scenario: A project has one primary link

- **WHEN** the owner marks a link as primary
- **THEN** that link is the only primary link of the project

#### Scenario: An unsupported isolation value is rejected

- **WHEN** the owner sets an isolation value other than `inherit`,
  `always_worktree`, or `never`
- **THEN** the request is rejected and the stored policy is unchanged

#### Scenario: An archived project rejects link edits

- **WHEN** the owner links, unlinks, or changes a link on an archived project
- **THEN** the request is rejected with `409`
- **AND** the links are unchanged

### Requirement: Project repository defaults remember the last chosen checkout per executor

For each link and each executor, a project MUST store at most one default
checkout. The default MUST name a main checkout of that repository on that
executor. A successful chat start MUST record the checkout it used as that
default. A checkout that is not a main checkout of the repository on that
executor MUST NOT become a default.

#### Scenario: A chat start records the default

- **WHEN** a chat starts on a link with executor E and main checkout C
- **THEN** the project stores C as the default for that link on E

#### Scenario: A worktree checkout never becomes a default

- **WHEN** a chat start uses a worktree checkout
- **THEN** the project does not store that checkout as a default

#### Scenario: A later chat start reuses the default

- **WHEN** the link has a default on executor E
- **THEN** a later chat start on that link and executor uses the stored checkout

#### Scenario: A new choice replaces the old default

- **WHEN** a chat start uses another main checkout of the repository on executor
  E
- **THEN** the project stores the new checkout as the default for that link on E

### Requirement: A project can have a default executor

A project MUST store zero or one default executor. The owner MUST set and clear
it under `/api/v1/projects/:id`. Chat creation MUST use a stored link default
before the project default executor.

#### Scenario: A new project has no default executor

- **WHEN** the owner creates a project
- **THEN** the project stores no default executor

#### Scenario: The owner sets a default executor

- **WHEN** the owner sets a default executor on a project
- **THEN** a chat start without an executor choice uses that executor

#### Scenario: The owner clears the default executor

- **WHEN** the owner clears the default executor
- **THEN** the project stores no default executor
- **AND** a later chat start resolves an executor another way

#### Scenario: A link default wins

- **WHEN** a link has a default checkout on executor E and the project stores
  another default executor
- **THEN** a chat start on that link uses E

### Requirement: Project repository links are deleted with the project

The system MUST delete a project's links and their defaults when the owner
deletes the project. The system MUST NOT delete a repository, a checkout, a
directory, or a file. The system MUST delete the links that name a repository
when the owner deletes that repository.

#### Scenario: A project deletion removes its links

- **WHEN** the owner deletes a project that links two repositories
- **THEN** the links and their defaults are gone
- **AND** both repositories and their checkouts remain

#### Scenario: Files stay after a project deletion

- **WHEN** the owner deletes a project
- **THEN** every checkout directory stays on its executor

#### Scenario: A deleted repository leaves no link

- **WHEN** the owner deletes a repository that two projects link
- **THEN** both links are gone
- **AND** both projects remain

### Requirement: Project repository links are owner-isolated

Only the owner of a project MUST read or change its links and defaults. A link
request that names another user's repository MUST fail as not found. A link
request on another user's project MUST fail as not found. A request without an
authenticated user MUST fail and change nothing.

#### Scenario: A foreign repository id fails as not found

- **WHEN** an owner links a repository id that belongs to another user
- **THEN** the request fails with `404`
- **AND** no link is stored

#### Scenario: Another owner's links are invisible

- **WHEN** a user reads or changes the links of a project they do not own
- **THEN** the request fails
- **AND** no link is returned or changed

#### Scenario: Two owners link the same repository

- **WHEN** two owners link the same repository to their own projects
- **THEN** each project lists only its own link

#### Scenario: An absent identity fails closed

- **WHEN** a link request arrives without an authenticated user
- **THEN** the request fails
- **AND** no link or default is read or written
