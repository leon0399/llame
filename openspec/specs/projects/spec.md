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
