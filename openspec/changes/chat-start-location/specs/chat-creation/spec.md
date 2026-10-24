# Spec Delta

## Purpose

Creates a chat with its project and Workspace location in one request. The first
Run then starts in the correct repository checkout, and no later filing step is
necessary.

## ADDED Requirements

### Requirement: A chat can be created with its project and location in one request

`POST /api/v1/chats` MUST accept `CreateChatRequest`, a schema separate from the
message request. The request MUST carry a client chat id. Optional fields are
`projectId`, `repositoryId`, `executorId`, `checkoutId`, `worktree` (`name`,
`baseRef`), and `message` (`id`, `modelId`, `effort`, `permissionMode`,
`parts`). The message request schema MUST NOT accept location fields. The
response MUST carry the chat and a `workspace` object.

#### Scenario: A chat is created with a location and a first message

- **WHEN** the owner sends a valid request with a project, a repository, an
  executor, and a message
- **THEN** the server stores the chat, files it into the project, and returns
  201 with the chat and a `bound` Workspace
- **AND** the first Run starts with that binding

#### Scenario: A chat is created without a message

- **WHEN** the owner sends a valid request and omits `message`
- **THEN** the chat is stored and no Run starts

#### Scenario: The message route does not accept location fields

- **WHEN** a client sends `repositoryId` in `POST /api/v1/chats/:id/messages`
- **THEN** the request is rejected as malformed and no message is stored

### Requirement: Location resolution uses project defaults and never a silent primary

The repository MUST be the primary link, else the single link, else none. The
server MUST NOT choose a primary when the links have no primary and the request
names no repository. The checkout MUST come from the remembered default for the
link, else the only main checkout on the resolved executor, else none.

#### Scenario: One linked repository resolves to its only checkout

- **WHEN** the owner sends a request with a project whose single link has one
  main checkout, and the request names no location
- **THEN** the chat binds to that checkout

#### Scenario: Several links and no primary choose no repository

- **WHEN** the project links two repositories, sets no primary, and the request
  names no `repositoryId`
- **THEN** the server chooses no repository, and `workspace.status` is `unbound`

#### Scenario: A named repository overrides the primary

- **WHEN** the request names a linked repository that is not the primary
- **THEN** the server resolves the location for that repository

### Requirement: Executor resolution skips offline Machines on implicit steps

The executor MUST resolve from an explicit `executorId`. Else it MUST use the
remembered default for the link. Else it MUST use the project default executor.
Else it MUST use the only executor that holds a main checkout. Else it MUST use
the online executor with the lowest id that holds one. The implicit steps MUST
skip an offline Machine.

#### Scenario: An offline Machine that holds the only checkout is skipped

- **WHEN** a Machine holds the only main checkout and is offline, and one local
  executor is online
- **THEN** the server skips the offline Machine, resolves no executor, and
  answers `workspace.status` `unbound`
- **AND** the message is stored and the Run starts

#### Scenario: The lowest executor id wins a tie

- **WHEN** two online executors each hold a main checkout and no default exists
- **THEN** the server selects the executor with the lowest id

### Requirement: Only an explicit executor or remembered default names an offline Machine

An explicit `executorId` or a remembered default that names an offline Machine
MUST answer `workspace.status` `machine_unavailable`. A local executor is this
process's `tools.nativeExecutorId` and is never offline.

#### Scenario: An explicit offline executor answers machine_unavailable

- **WHEN** the request names the executor id of an offline Machine
- **THEN** the response is 201 with `workspace.status` `machine_unavailable`
- **AND** no worktree command starts and the message is not stored

#### Scenario: A remembered default on an offline Machine answers machine_unavailable

- **WHEN** the remembered default for the link names an offline Machine and the
  request names no `executorId`
- **THEN** the response is 201 with `workspace.status` `machine_unavailable`

### Requirement: One link and one executor store one default checkout

For each link and executor pair, the project MUST store at most one default
checkout. Each default MUST record `updated_at`, the time of its last write.
When the resolved link has defaults on several executors, the most recently
written row MUST win.

#### Scenario: The most recently written default wins

- **WHEN** the resolved link holds one default on a local executor and one on a
  Machine
- **THEN** the server selects the default that was written most recently

### Requirement: A create request with a message validates it before any write

When the request carries `message`, the server MUST validate it before the first
write. It MUST check the model, the effort, the permission mode, the parts, and
the media ownership. A failed check MUST answer as the message route does. It
MUST store nothing.

#### Scenario: An unavailable model stores nothing

- **WHEN** the request names an unavailable model
- **THEN** the response is 422 and no chat, binding, or message is stored

#### Scenario: A media part of another owner stores nothing

- **WHEN** the request carries a media part that belongs to another owner
- **THEN** the response is 400 and no chat, binding, or message is stored

### Requirement: Creation runs its steps in one fixed order

The server MUST validate the message and the named ids. It MUST then store the
chat, authorize the Workspace, and create the worktree when requested. It MUST
then store the binding, store the message, and enqueue the Run. The server MUST
NOT enqueue a Run before the message and the binding are stored. The request's
`worktree` field MUST decide worktree creation.

#### Scenario: The first Run starts after the binding is stored

- **WHEN** every step succeeds for a request with a `worktree`
- **THEN** the worktree exists before the binding is stored
- **AND** the first Run starts with the worktree binding in place

#### Scenario: A request without a worktree binds the checkout

- **WHEN** the request omits `worktree` and the checkout resolves
- **THEN** the server binds the checkout and starts no worktree command

### Requirement: The Workspace step uses the request permission mode

The Workspace step MUST use `message.permissionMode`, and `default` when absent.
A `bypass` request on a process whose `tools.permissionModes` does not enable it
MUST answer 422 before any store. The step MUST NOT record its path decisions as
Run decisions.

#### Scenario: bypass on a process without bypass stores nothing

- **WHEN** the request sets `permissionMode` to `bypass` and the process does not
  enable `bypass`
- **THEN** the response is 422 and no chat, binding, or message is stored

#### Scenario: An enabled bypass applies to both path decisions

- **WHEN** the request sets `permissionMode` to `bypass` and the process enables
  `bypass`
- **THEN** both path decisions are evaluated in `bypass` mode

### Requirement: The Workspace step requires the entry gates

The step MUST require `enter_workspace` in `tools.allowed`. For a local
executor, `tools.nativeExecutorId` MUST equal the resolved executor id. A
missing allowlist entry MUST answer `bind_failed` with `code` `tool_not_allowed`.
A missing or different native id MUST answer `bind_failed` with `code`
`executor_unavailable`.

#### Scenario: Workspace entry is not allowlisted

- **WHEN** `enter_workspace` is absent from `tools.allowed` and the location
  resolves
- **THEN** the response is 201 with `workspace.status` `bind_failed` and `code`
  `tool_not_allowed`
- **AND** the chat stays filed and unbound and the message is not stored

#### Scenario: No native executor is configured

- **WHEN** the local executor resolves and `tools.nativeExecutorId` is unset
- **THEN** the response is 201 with `workspace.status` `bind_failed` and `code`
  `executor_unavailable`

### Requirement: A rejected path refuses the binding before any git command

The submitted path and the canonical path MUST each be decided by the
`enter_workspace` permission group. A rejection or a missing allow for either
path MUST answer `bind_failed` with `code` `permission_denied`. The step MUST
store no binding and MUST start no worktree command.

#### Scenario: A rejected submitted path stops the creation

- **WHEN** the `enter_workspace` permission group rejects the submitted path
- **THEN** the response is 201 with `workspace.status` `bind_failed` and `code`
  `permission_denied`
- **AND** no worktree command starts, no binding is stored, and the chat record
  stays

#### Scenario: A rejected canonical path stops the creation

- **WHEN** the submitted path is allowed and the canonical path is rejected
- **THEN** the response is 201 with `workspace.status` `bind_failed` and `code`
  `permission_denied`
- **AND** no worktree command starts and no binding is stored

### Requirement: The response workspace object has one closed status set

The `workspace` object MUST carry `status`. It can also carry `root`,
`executorId`, `worktree` (`path`, `branch`, `baseCommit`), `code`, and
`message`. `status` MUST be one of `bound`, `unbound`, `bind_failed`,
`worktree_failed`, `machine_unavailable`, `machine_update_required`.

#### Scenario: A bound start names its location

- **WHEN** the Workspace step binds the worktree
- **THEN** `workspace.status` is `bound`
- **AND** `root`, `executorId`, and `worktree` name the root, the executor, the
  path, the branch, and the base commit

#### Scenario: An unbound start names no root

- **WHEN** no location resolves
- **THEN** `workspace.status` is `unbound` and `workspace.root` is absent

### Requirement: An unresolved location stores the message and starts the Run

When no location resolves, the server MUST store the chat and the message. It
MUST start the Run. It MUST answer 201 with `workspace.status` `unbound`.

#### Scenario: A start without a resolvable location still sends

- **WHEN** the project links two repositories with no primary and the request
  names no location
- **THEN** the chat and the message are stored and the Run starts
- **AND** the response is 201 with `workspace.status` `unbound`

### Requirement: Failure statuses carry one cause code

A path outside the Machine's registered roots MUST answer `worktree_failed` with
`code` `path_not_registered`. A git timeout MUST answer `worktree_failed` with
`code` `timeout`. A non-repository source MUST answer `worktree_failed` with
`code` `not_a_repository`. A daemon that lists no git method MUST answer
`workspace.status` `machine_update_required`.

#### Scenario: A worktree path outside the registered roots fails

- **WHEN** the Machine refuses the worktree directory as `path_not_registered`
- **THEN** the response is 201 with `workspace.status` `worktree_failed` and
  `code` `path_not_registered`
- **AND** the chat stays filed and unbound and the message is not stored

#### Scenario: A worktree command times out

- **WHEN** the worktree command reaches its timeout
- **THEN** the response is 201 with `workspace.status` `worktree_failed` and
  `code` `timeout`

#### Scenario: An outdated daemon refuses the start

- **WHEN** the Machine handshake lists no git method
- **THEN** the response is 201 with `workspace.status` `machine_update_required`
- **AND** no git request is sent and the message is not stored

### Requirement: A failed workspace leaves the chat filed and unbound

If the Workspace step or the worktree creation fails, the server MUST keep the
stored chat and its project. It MUST store no binding, no defaults row, and no
lease. It MUST NOT store the message or enqueue the Run. It MUST answer 201 with
the failure `status` and `code`. The client MUST keep the message for a later
send.

#### Scenario: Worktree creation fails

- **WHEN** the worktree command fails
- **THEN** the response is 201 with `workspace.status` `worktree_failed`
- **AND** the chat stays filed and unbound, the message is not stored, and no
  Run starts

#### Scenario: Binding fails after the worktree exists

- **WHEN** the bind fails after the worktree command succeeded
- **THEN** the server removes the worktree and its rows, and no lease remains
- **AND** the response is 201 with `workspace.status` `bind_failed` and the chat
  stays filed and unbound

#### Scenario: Binding fails after the path decisions

- **WHEN** the Workspace step fails after the path decisions
- **THEN** the response is 201 with `workspace.status` `bind_failed`
- **AND** the chat stays filed and unbound, and the message is not stored

### Requirement: The message insert and the Run enqueue share one transaction

The server MUST insert the message and enqueue the Run in one transaction. An
enqueue failure MUST answer 5xx and MUST store no message. The chat and the
binding MUST remain stored. A retry with the same chat id MUST be allowed.

#### Scenario: An enqueue failure stores no message

- **WHEN** the enqueue fails after the binding is stored
- **THEN** the response is 5xx and no message is stored
- **AND** the chat and the binding remain stored

#### Scenario: A retry after an enqueue failure succeeds

- **WHEN** the owner resends the same chat id after an enqueue failure
- **THEN** the request is accepted, the message is stored, and the Run starts

### Requirement: A resent create request re-runs the remaining steps

A same-owner request with a stored chat id MUST re-run its steps when the chat
holds no message. It MUST run the message validation, the location steps, the
worktree step, the binding step, and the message step. It MUST answer 201. An
existing binding to the same root MUST be a no-op. A stored chat that holds a
message MUST answer 409. A chat id of another owner MUST answer 404.

#### Scenario: A resend after a failed workspace binds the corrected location

- **WHEN** the first request answered `bind_failed` and the owner resends the
  same chat id with a corrected location
- **THEN** the server re-runs the location steps and answers 201 with
  `workspace.status` `bound`
- **AND** the message is stored and the Run starts

#### Scenario: A resend with an existing binding is a no-op

- **WHEN** the chat is already bound to the resolved root and the owner resends
  the same chat id
- **THEN** the server keeps the binding and creates no second worktree

#### Scenario: A resend of a chat with a message is a conflict

- **WHEN** the stored chat already holds a message and the owner resends the
  same chat id
- **THEN** the request fails with 409 and the stored chat is unchanged

#### Scenario: A stored id of another owner is not found

- **WHEN** a user sends a chat id that is stored for a different owner
- **THEN** the request fails with 404 and no chat is created
- **AND** the response discloses no field of the other owner's chat

### Requirement: Chat creation is owner-isolated

The server MUST derive the owner from the session and store the chat under that
owner. It MUST validate `projectId`, `repositoryId`, `executorId`, and
`checkoutId` under owner row-level security. The check MUST run in the same
transaction as the chat insert and MUST precede it. A foreign or missing id MUST
answer 404 and store nothing. An archived project MUST answer 409 and store
nothing.

#### Scenario: A foreign project is not found

- **WHEN** owner A sends a request with a project id of owner B
- **THEN** the request fails with 404 and no chat is stored

#### Scenario: A foreign checkout is not found

- **WHEN** the request names a checkout that belongs to another owner
- **THEN** the request fails with 404 and no chat or binding is stored

#### Scenario: A missing checkout is not found

- **WHEN** the request names a checkout id that no longer exists
- **THEN** the request fails with 404 and no chat is stored

#### Scenario: An archived project refuses the chat

- **WHEN** the request names a project that is archived
- **THEN** the request fails with 409 and no chat is stored

#### Scenario: Owner references resolve

- **WHEN** every named project, repository, and checkout belongs to the sender
- **THEN** the chat is stored under that owner and filed into that project

### Requirement: The first-message creation path is unchanged

`POST /api/v1/chats/:id/messages` MUST keep its current behavior. A first
message to an unknown chat id MUST create a chat with no project and no binding.
A message to an existing chat MUST NOT change its project or its binding.
`PATCH /api/v1/chats/:id` MUST keep filing a chat.

#### Scenario: A first message creates an unfiled chat

- **WHEN** a client posts a first message for an unknown chat id
- **THEN** the chat is stored with no project and no Workspace binding

#### Scenario: Filing stays a separate request

- **WHEN** the owner files the chat with `PATCH /api/v1/chats/:id`
- **THEN** the chat gains the project and no Workspace binding changes
