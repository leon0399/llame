# projects

## Purpose

A project is a first-class, terminal, user-owned chat group. This capability covers the project entity, chat↔project association, and owner-only visibility. It introduces **no cross-user access path**. Membership and shared reads, org-unit ownership, roster inheritance, knowledge, tools, and filesystem workspaces remain explicit follow-up capabilities; the sharing slice's RLS-recursion analysis is retained in the archived change's `design.md` D5.

## Requirements

### Requirement: Project entity and ownership

The system SHALL provide a **project** as a first-class, terminal workspace that groups a user's chats. A project SHALL NOT contain child projects or any nested unit — it holds chats only. Each project SHALL have exactly one **owner user**, and SHALL be stored as its own entity, distinct from org units.

Each project SHALL carry a required **name** and MAY carry a **description**: owner-authored free text about what the project is for. A project SHALL have no description until its owner sets one, and a description SHALL be bounded at 1000 characters, so that recording one never becomes a way to store an unbounded document on the row.

This foundation ships **user-owned projects** only. Org-unit ownership and invited members are explicitly deferred to a following change; the model anticipates them (see design), but no such column, table, or surface ships here.

#### Scenario: A user creates a project they own

- **WHEN** a signed-in user creates a project with a name
- **THEN** the project is persisted with that user as its owner, and it appears in that user's project list

#### Scenario: Projects are terminal

- **WHEN** any attempt is made to nest a project under another project or give it a child unit
- **THEN** there is no surface to do so — the project model exposes chats only

#### Scenario: A project name is required

- **WHEN** a project is created without a name
- **THEN** the request is rejected; a name is required (two projects of the same owner MAY share a name)

#### Scenario: A project starts with no description

- **WHEN** a signed-in user creates a project with a name only
- **THEN** the project has no description, and one may be set later by its owner

#### Scenario: A project is created with a description

- **WHEN** a signed-in user creates a project with a name and a description within the bound
- **THEN** the project is persisted with that description

#### Scenario: A description beyond the bound is rejected

- **WHEN** a user sets a description longer than the bound
- **THEN** the request is rejected and the stored description is unchanged

### Requirement: Chat association with a project

A chat SHALL belong to **at most one** project. A chat's owner SHALL be able to **file** the chat into a project they own and **unfile** it. Deleting a project SHALL **unfile** its chats — the chats and their conversation history SHALL survive; a deleted project SHALL NOT cascade-delete chats.

#### Scenario: Filing a chat into a project

- **WHEN** a user files one of their chats into a project they own
- **THEN** the chat is associated with that project and appears grouped under it

#### Scenario: An unfiled chat is the default

- **WHEN** a chat has not been filed into any project
- **THEN** it has no project association and appears in the ungrouped chat list

#### Scenario: Deleting a project preserves its chats

- **WHEN** a project that contains chats is deleted
- **THEN** its chats are unfiled (no longer associated with any project) and remain readable by their owner; no conversation history is lost

### Requirement: Project visibility and management surface

Projects SHALL be visible and manageable only to their owner, enforced in the datastore (defense-in-depth) and failing closed when the caller's identity is absent. The API SHALL expose project create/read/list/update/delete and chat filing as REST resources, each taking a validated request DTO and returning an explicit response type, deriving the acting identity only from the authenticated session (never from client-supplied ownership input), and surfacing authorization denials honestly rather than returning empty results. The owner SHALL be able to set, change, and clear a project's description through that update resource: a description omitted from the request SHALL leave the stored one unchanged, and one cleared SHALL return the project to no description. The project list SHALL honor the `?archived` and `?pinned` filter contract specified in `item-archive` (default list excludes archived and shows both pinned states; `?archived=with` includes archived, `?pinned=only` returns pinned projects, `?pinned=exclude` returns non-pinned). An archived project SHALL reject every update other than unarchive (`PATCH archived=false`) and delete (`DELETE`), refused with `409 Conflict` — a description change included. A public/shared project SHALL remain viewable and forkable when archived.

#### Scenario: Listing projects returns only the caller's projects

- **WHEN** a user lists projects
- **THEN** the response contains exactly the projects they own, and no others

#### Scenario: The default project list excludes archived projects

- **WHEN** a user lists projects without `?archived`
- **THEN** archived projects are absent from the result

#### Scenario: Archived projects are surfaced by query param

- **WHEN** a user lists projects with `?archived=with`
- **THEN** archived projects are included in the response

#### Scenario: Pinned projects are filterable

- **WHEN** a user lists projects with `?pinned=only` or `?pinned=exclude`
- **THEN** the result contains only pinned or only non-pinned projects respectively

#### Scenario: A non-owner cannot see or manage a project

- **WHEN** a user requests, updates, or deletes a project they do not own
- **THEN** access is denied — the project is not returned and no change is made

#### Scenario: The owner sets and clears a description

- **WHEN** a user updates a project they own with a description, then updates it again with that description cleared
- **THEN** the first update stores the description and the second leaves the project with no description

#### Scenario: An archived project rejects edits but allows unarchive and delete

- **WHEN** a user renames an archived project they own, or changes its description
- **THEN** the request is refused with `409`; a `PATCH ... archived:false` or `DELETE` on that project succeeds

#### Scenario: A shared project stays viewable when archived

- **WHEN** a public/shared project is archived
- **THEN** its share link still returns the project (viewing and forking remain allowed)

#### Scenario: Identity is server-derived

- **WHEN** a request carries a client-supplied owner id that differs from the authenticated user
- **THEN** the server ignores the client-supplied identity and authorizes against the authenticated session

### Requirement: Projects introduce no cross-user chat access

Introducing projects SHALL NOT widen access to any chat. Filing a chat into a project SHALL NOT make it readable by anyone other than its existing owner (and existing public-share behavior); a project and the chats filed into it are visible only to the owner. Cross-user chat access via shared project membership is a separate, later change; until it ships, no membership-based read path exists.

#### Scenario: A filed chat is no more visible than before

- **WHEN** a user files a private chat into a project
- **THEN** the chat's readership is unchanged — only its owner can read it (and public chats keep existing public-read behavior)

#### Scenario: No membership read path exists yet

- **WHEN** any user who is not a chat's owner attempts to read it by virtue of a project
- **THEN** access is denied — this foundation grants no project-based access to another user's chats

### Requirement: A project links repositories with an alias and a primary link

Each project MUST store zero or more links to repositories of its owner. A link
MUST carry an alias and a primary flag. A project MUST have no more than one
primary link. The owner MUST link, unlink, and change a link under
`/api/v1/projects/:id/repositories`.

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

#### Scenario: An archived project rejects link edits

- **WHEN** the owner links, unlinks, or changes a link on an archived project
- **THEN** the request is rejected with `409`
- **AND** the links are unchanged

### Requirement: An isolation policy selects the default isolation of a chat start

A link MUST carry an isolation policy of `inherit`, `always_worktree`, or
`never`. The policy MUST default to `inherit`. The policy MUST select the
default isolation that the composer shows. The request's `worktree` field MUST
decide the outcome.

#### Scenario: The policy sets the composer default

- **WHEN** a chat starts on a link whose isolation policy is `always_worktree`
- **THEN** the composer shows the worktree isolation as the default
- **AND** the `worktree` field of the request decides the outcome

#### Scenario: An unsupported isolation value is rejected

- **WHEN** the owner sets an isolation value other than `inherit`,
  `always_worktree`, or `never`
- **THEN** the request is rejected and the stored policy is unchanged

### Requirement: Project repository defaults remember the last chosen checkout per executor

For each link and each executor, a project MUST store at most one default
checkout. That default MUST be a main checkout of the repository on that
executor.

A successful chat start MUST attempt to record the main checkout it used, or the
source main checkout of a worktree, as that default. That write MUST run after
the commit, it MUST be best-effort, and the last write MUST win.

#### Scenario: A chat start records the default

- **WHEN** a chat starts on a link with executor E and main checkout C
- **THEN** the project stores C as the default for that link on E

#### Scenario: A worktree start records its source main checkout

- **WHEN** a chat start uses a worktree of main checkout C on executor E
- **THEN** the project stores C as the default for that link on E
- **AND** it stores no worktree checkout as a default

#### Scenario: A later chat start reuses the default

- **WHEN** the link has a default on executor E
- **THEN** a later chat start on that link and executor uses the stored checkout

#### Scenario: A new choice replaces the old default

- **WHEN** a chat start uses another main checkout of the repository on executor
  E
- **THEN** the project stores the new checkout as the default for that link on E

### Requirement: The latest defaults write wins

Each defaults row MUST record `updated_at`, the time of its last write. When a
link has defaults on several executors, the most recently written row MUST win.

#### Scenario: Defaults on two executors resolve to the last write

- **WHEN** a link stores a default on executor E1, then a default on executor E2
- **THEN** a chat start on that link uses the default on E2

### Requirement: A failed defaults write does not fail the chat start

A failed defaults write MUST NOT fail the chat start, and it MUST leave the
previous defaults row in place.

#### Scenario: A failed defaults write does not fail a later start

- **WHEN** the defaults write fails after the chat start binds
- **THEN** the chat start keeps its bound root
- **AND** the previous defaults row stays

### Requirement: A project can have a default executor

A project MUST store zero or one default executor. The owner MUST set and clear
it under `/api/v1/projects/:id`. Chat creation MUST use a stored link default
before the project default executor, and only for a request that names a
location. An archived project MUST reject a change to its default executor with
`409`.

#### Scenario: A new project has no default executor

- **WHEN** the owner creates a project
- **THEN** the project stores no default executor

#### Scenario: The owner sets a default executor

- **WHEN** the owner sets a default executor on a project
- **THEN** a chat start that names a location and no executor uses that
  executor

#### Scenario: The owner clears the default executor

- **WHEN** the owner clears the default executor
- **THEN** the project stores no default executor
- **AND** a later chat start resolves an executor another way

#### Scenario: A link default wins

- **WHEN** a link has a default checkout on executor E and the project stores
  another default executor
- **THEN** a chat start on that link uses E

#### Scenario: An archived project rejects a default executor change

- **WHEN** the owner sets or clears the default executor of an archived project
- **THEN** the request is rejected with `409`
- **AND** the stored default executor is unchanged

### Requirement: Project repository links are deleted with the project

The system MUST delete a project's links and their defaults when the owner
deletes the project. The system MUST delete a default when the owner deletes the
checkout it names. The system MUST delete a link's defaults when the owner
unlinks its repository. The system MUST NOT delete a repository, a checkout, a
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

#### Scenario: A deleted main checkout leaves no default

- **WHEN** the owner deletes a main checkout that a link stores as its default
- **THEN** that default is gone
- **AND** the link and the repository remain

#### Scenario: Unlinking removes the link's defaults

- **WHEN** the owner unlinks a repository from a project
- **THEN** every default of that link is gone

### Requirement: The owner reads a project's links and their defaults

`GET /api/v1/projects/:id/repositories` MUST return each link with its alias,
primary flag, and isolation policy. It MUST return each link's defaults with
their executor, checkout, and `updated_at`. A read MUST write nothing. A project
of another owner MUST answer 404.

#### Scenario: The owner reads the links with their defaults

- **WHEN** the owner reads the links of a project that links two repositories
- **THEN** both links come back with their alias, primary flag, and isolation
- **AND** each default comes back with its executor and `updated_at`

#### Scenario: A foreign project read is not found

- **WHEN** a user reads the links of another user's project
- **THEN** the response is 404 and it returns no link

### Requirement: Project repository links are owner-isolated

Only the owner of a project MUST read or change its links and defaults. Each
link and default row MUST carry its owner id. A row MUST reference only that
owner's project, repository, and checkout. The system MUST refuse a row that
names another owner's record. A link request that names another user's
repository or another user's project MUST fail as not found. A request without
an authenticated user MUST fail and change nothing.

#### Scenario: A link row cannot name a foreign repository

- **WHEN** a link row of the owner's project names another owner's repository
- **THEN** the datastore refuses the row and stores no link

#### Scenario: A defaults row cannot name a foreign checkout

- **WHEN** a defaults row of the owner's link names another owner's checkout
- **THEN** the datastore refuses the row and stores no default

#### Scenario: A foreign repository id fails as not found

- **WHEN** an owner links a repository id that belongs to another user
- **THEN** the request fails with `404`
- **AND** no link is stored

#### Scenario: Another owner's links are invisible

- **WHEN** a user reads or changes the links of a project they do not own
- **THEN** the request fails
- **AND** no link is returned or changed

#### Scenario: Two owners link repositories with the same remote

- **WHEN** two owners each register a repository with the same remote and link
  it to their own projects
- **THEN** each project lists only its own link

#### Scenario: An absent identity fails closed

- **WHEN** a link request arrives without an authenticated user
- **THEN** the request fails
- **AND** no link or default is read or written
