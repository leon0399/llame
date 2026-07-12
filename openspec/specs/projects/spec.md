# projects

## Purpose

A project is a first-class, terminal, user-owned chat group — the foundation slice of the GitHub-repo-style workspace model (SPEC §1: projects with their own chats, knowledge, connectors, skills, artifacts, and members). This capability covers the projects entity, chat↔project association, and its owner-only visibility. It deliberately introduces **no cross-user access path**: membership/invites + shared reads, org-unit ownership + roster inheritance are sequenced follow-up changes (the sharing slice's RLS-recursion analysis is carried in the archived change's design.md D5).

## Requirements

### Requirement: Project entity and ownership

The system SHALL provide a **project** as a first-class, terminal workspace that groups a user's chats. A project SHALL NOT contain child projects or any nested unit — it holds chats only. Each project SHALL have exactly one **owner user**, and SHALL be stored as its own entity, distinct from org units.

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

Projects SHALL be visible and manageable only to their owner, enforced in the datastore (defense-in-depth) and failing closed when the caller's identity is absent. The API SHALL expose project create/read/list/update/delete and chat filing as REST resources, each taking a validated request DTO and returning an explicit response type, deriving the acting identity only from the authenticated session (never from client-supplied ownership input), and surfacing authorization denials honestly rather than returning empty results.

#### Scenario: Listing projects returns only the caller's projects

- **WHEN** a user lists projects
- **THEN** the response contains exactly the projects they own, and no others

#### Scenario: A non-owner cannot see or manage a project

- **WHEN** a user requests, updates, or deletes a project they do not own
- **THEN** access is denied — the project is not returned and no change is made

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
