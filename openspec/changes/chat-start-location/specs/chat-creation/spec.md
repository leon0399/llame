# Spec Delta

## Purpose

Creates a chat with its project and Workspace location in one request. The first
Run then starts in the correct repository checkout, and no later filing step is
necessary.

## ADDED Requirements

### Requirement: A chat can be created with its project and location in one request

The system MUST provide `POST /api/v1/chats` with its own request schema,
`CreateChatRequest`, which is distinct from the message request schema. The
request MUST carry a client chat id. It can carry `projectId`, `repositoryId`,
`executorId`, `checkoutId`, `worktree` (`name`, `baseRef`), and `message`
(`modelId`, `effort`, `permissionMode`, `parts`). The location fields MUST NOT
appear in the message request schema. The response MUST describe the chat and
its Workspace status.

#### Scenario: A chat is created with a location and a first message

- **WHEN** the owner sends a valid request with a project, a repository, an
  executor, and a message
- **THEN** the server stores the chat, files the chat into the project, and
  returns 201 with the chat and a bound Workspace
- **AND** the first Run starts with that binding

#### Scenario: A chat is created without a message

- **WHEN** the owner sends a valid request and omits `message`
- **THEN** the chat is stored and no Run starts

#### Scenario: The message route does not accept location fields

- **WHEN** a client sends `repositoryId` in `POST /api/v1/chats/:id/messages`
- **THEN** the request is rejected as malformed and no message is stored

### Requirement: Location resolution uses project defaults and never a silent primary

The server MUST resolve each omitted field from the project. The
repository MUST be the primary link, or the single link, else none. The executor
MUST come from the remembered default, the project default executor, the only
executor with a main checkout, or the first online executor. The checkout MUST
come from the remembered default, else the only main checkout on that executor.
It MUST NOT choose a primary when several links exist, no primary exists, and
the request names no repository.

#### Scenario: One linked repository resolves to its only checkout

- **WHEN** the owner sends a request with a project whose single link has one
  main checkout, and the request names no location
- **THEN** the chat binds to that checkout

#### Scenario: Several links and no primary stay unbound

- **WHEN** the project links two repositories, sets no primary, and the request
  names no `repositoryId`
- **THEN** the server chooses no repository, and the chat is stored filed and
  unbound

#### Scenario: A named repository overrides the primary

- **WHEN** the request names a linked repository that is not the primary
- **THEN** the server resolves the location for that repository

#### Scenario: An offline executor is not selected

- **WHEN** a Machine holds the only main checkout but is offline, and one local
  executor is online
- **THEN** the server selects the online executor and the checkout resolves to
  none

### Requirement: Creation order is chat record, workspace, worktree, then first Run

The server MUST do these steps in this order: store the chat record, authorize
the Workspace, create the worktree, store the binding, then enqueue the first
Run. The Workspace step MUST make the same path decisions as `enter_workspace`,
under the chat's permission mode. An omitted permission mode MUST mean `default`.
The server MUST NOT enqueue a Run before it stores the binding. When the request
carries no `worktree`, the server MUST bind the checkout and create no worktree.

#### Scenario: The first Run starts after the binding is stored

- **WHEN** every step succeeds for a request with a worktree
- **THEN** the first Run starts with the worktree binding in place

#### Scenario: A request without a worktree binds the checkout

- **WHEN** the request omits `worktree` and the checkout resolves
- **THEN** the server binds the checkout and starts no worktree command

#### Scenario: A rejected path stops before the worktree command

- **WHEN** the canonical-path decision rejects the worktree path
- **THEN** no worktree command starts, no binding is stored, and the chat record
  stays

#### Scenario: A permission mode applies to both path decisions

- **WHEN** the request sets `permissionMode` to `bypass` and the evaluation
  yields a bypass decision
- **THEN** both path decisions are recorded as bypass decisions

### Requirement: A failed workspace leaves the chat filed and unbound

If the Workspace step or the worktree creation fails, the server MUST keep the
stored chat and its project. It MUST store no binding. It MUST NOT store or
enqueue the message. It MUST return 201 with a `workspace` object whose `status`
is `bind_failed`, `worktree_failed`, or `machine_unavailable`, and whose
`message` states the cause. The client MUST keep the message for a later send.

#### Scenario: Worktree creation fails

- **WHEN** the worktree command fails
- **THEN** the response is 201 with `workspace.status` `worktree_failed`
- **AND** the chat stays filed and unbound, the message is not stored, and no
  Run starts

#### Scenario: Binding fails

- **WHEN** the Workspace step fails after the path decisions
- **THEN** the response is 201 with `workspace.status` `bind_failed`
- **AND** the chat stays filed and unbound, and the message is not stored

#### Scenario: The executor is offline

- **WHEN** the selected executor is offline
- **THEN** the response is 201 with `workspace.status` `machine_unavailable`
- **AND** no worktree command starts and the message is not stored

### Requirement: Chat creation is idempotent by client id

The request MUST carry a client-generated chat id. A second `POST
/api/v1/chats` with a stored id MUST fail with 409. That request MUST NOT change
the chat, its project, its binding, or its messages. A retry with the same id
MUST NOT create a second chat. The owner MUST come from the session, so the id
is not a credential.

#### Scenario: A repeated request is a conflict

- **WHEN** the owner sends two requests with the same chat id
- **THEN** the second request fails with 409 and the stored chat is unchanged

#### Scenario: A retry after a failed workspace is a conflict

- **WHEN** the first request returned `bind_failed` and the owner sends the same
  id again
- **THEN** the request fails with 409 and the chat stays unbound

#### Scenario: A stored id of another owner is not reused

- **WHEN** a user sends a chat id that is stored for a different owner
- **THEN** the request fails with 409, no chat is created, and the response
  discloses no field of the other owner's chat

### Requirement: Chat creation is owner-isolated

The server MUST derive the owner from the session and MUST store the chat under
that owner. A `projectId`, `repositoryId`, or `checkoutId` that the owner does
not hold MUST produce a not-found response. A not-found response MUST NOT store
the chat. It MUST NOT disclose the other owner's record. The isolation MUST hold
for every location field.

#### Scenario: A foreign project is not found

- **WHEN** owner A sends a request with a project id of owner B
- **THEN** the request fails with 404 and no chat is stored

#### Scenario: A foreign checkout is not found

- **WHEN** the request names a checkout that belongs to another owner
- **THEN** the request fails with 404 and no binding is stored

#### Scenario: Owner references resolve

- **WHEN** every named project, repository, and checkout belongs to the sender
- **THEN** the chat is stored under that owner and filed into that project

### Requirement: The first-message creation path is unchanged

`POST /api/v1/chats/:id/messages` MUST keep its current behavior. It MUST create
the chat on the first message, and it MUST leave the chat unfiled and unbound.
The route MUST NOT accept location fields. `PATCH /api/v1/chats/:id` MUST keep
the route that files a chat. Clients that send no location MUST continue to
work.

#### Scenario: A first message creates an unfiled chat

- **WHEN** a client posts a first message for an unknown chat id
- **THEN** the chat is stored with no project and no Workspace binding

#### Scenario: Filing stays a separate request

- **WHEN** the owner files the chat with `PATCH /api/v1/chats/:id`
- **THEN** the chat gains the project and no Workspace binding changes
