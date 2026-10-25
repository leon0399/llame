# Spec Delta

## Purpose

Creates a chat with its project and Workspace location in one request. The first
Run then starts in the correct repository checkout, and no later step is
necessary to file the chat.

## ADDED Requirements

### Requirement: A chat can be created with its project and location in one request

`POST /api/v1/chats` MUST accept `CreateChatRequest`, a schema of its own. The
request MUST carry a client chat id. Optional fields are `projectId`,
`repositoryId`, `executorId`, `checkoutId`, `worktree` (`name`, `baseRef`), and
`message`. The message request schema MUST NOT accept location fields. The
response MUST carry the chat and a `workspace` object.

#### Scenario: A chat is created with a location and a first message

- **WHEN** the owner sends a valid request with a project, a repository, an
  executor, and a message
- **THEN** the server stores the chat, files it into the project, and returns
  201 with the chat and a `bound` Workspace
- **AND** the first Run starts with that bound root

#### Scenario: A chat is created without a message

- **WHEN** the owner sends a valid request and omits `message`
- **THEN** the chat is stored and no Run starts

#### Scenario: The message route does not accept location fields

- **WHEN** a client sends `repositoryId` in `POST /api/v1/chats/:id/messages`
- **THEN** the request is rejected as malformed and no message is stored

### Requirement: The create location is opt-in

A request that names no `repositoryId`, no `executorId`, and no `checkoutId`
MUST resolve no location, whatever the project links and the remembered
defaults. A request that names no location and sets `worktree` MUST answer 422.

#### Scenario: A request without a location binds nothing

- **WHEN** the owner sends a request with a project whose single link has one
  main checkout, and the request names no location
- **THEN** `workspace.status` is `unbound` and the chat stores no bound root

#### Scenario: A worktree without a location is rejected

- **WHEN** the request sets `worktree` and names no repository, executor, or
  checkout
- **THEN** the response is 422 and nothing is stored

### Requirement: A named location resolves through project defaults and never a silent primary

When the request names a location, the repository MUST be the request's
`repositoryId`, else the primary link, else the single link, else none. The
server MUST NOT choose a primary when the links have no primary. The checkout
MUST come from the remembered default for the link. Else it MUST be the only
main checkout of the resolved repository on the resolved executor, else none.
An explicit `repositoryId` or `checkoutId` MUST override a remembered default.

#### Scenario: A named repository resolves to its only checkout

- **WHEN** the request names the single linked repository, and it has one main
  checkout
- **THEN** the chat binds to that checkout

#### Scenario: A named repository overrides the primary

- **WHEN** the request names a linked repository that is not the primary
- **THEN** the server resolves the location for that repository

#### Scenario: An explicit id overrides a remembered default

- **WHEN** the link stores a default checkout and the request names another
  linked checkout
- **THEN** the server resolves the named checkout

### Requirement: Executor resolution skips offline Machines on implicit steps

The executor MUST resolve from an explicit `executorId`, else the link's
remembered default, else the project default executor. Else it MUST be the only
executor that holds a main checkout of the resolved repository. Else it MUST be
the online executor with the lowest id that holds one.

The implicit steps MUST skip an offline Machine. An explicit `executorId` that
no configuration provides MUST answer 422 with `code` `executor_unknown` and
store nothing.

#### Scenario: An offline Machine that holds the only checkout is skipped

- **WHEN** a Machine holds the only main checkout and is offline, and one local
  executor is online
- **THEN** the server skips the offline Machine, resolves no executor, and
  answers `workspace.status` `unbound`
- **AND** the message is stored and the Run starts

#### Scenario: The lowest executor id wins a tie

- **WHEN** two online executors each hold a main checkout and no default exists
- **THEN** the server selects the executor with the lowest id

#### Scenario: An executor that holds only another repository's checkout is skipped

- **WHEN** the project links repository A, and an executor holds only a main
  checkout of repository B
- **THEN** the server does not select that executor and resolves no checkout
- **AND** `workspace.status` is `unbound`

#### Scenario: An unknown executor id is rejected

- **WHEN** the request names an executor id that no configuration provides
- **THEN** the response is 422 with `code` `executor_unknown`
- **AND** no chat, bound root, or message is stored

### Requirement: Only an explicit executor, a named checkout, or a remembered default names an offline Machine

An explicit `executorId`, a named `checkoutId`, or a remembered default that
names an offline Machine MUST answer `workspace.status` `machine_unavailable`. A
local executor is this process's `tools.nativeExecutorId` and is never offline.

#### Scenario: An explicit offline executor answers machine_unavailable

- **WHEN** the request names the executor id of an offline Machine
- **THEN** the response is 201 with `workspace.status` `machine_unavailable`
- **AND** no worktree command starts and the message is not stored

#### Scenario: A named checkout on an offline Machine answers machine_unavailable

- **WHEN** the request names a `checkoutId` of a main checkout on an offline
  Machine
- **THEN** the response is 201 with `workspace.status` `machine_unavailable`
- **AND** no git call starts and the message is not stored

#### Scenario: A remembered default on an offline Machine answers machine_unavailable

- **WHEN** the remembered default for the link names an offline Machine and the
  request names no `executorId`
- **THEN** the response is 201 with `workspace.status` `machine_unavailable`

### Requirement: A named checkout decides its repository and executor

A named `checkoutId` MUST decide its repository and its executor. It MUST be a
`main` checkout, and a worktree row MUST answer 422. A given `repositoryId` or
`executorId` that disagrees with it MUST answer 422. A 422 MUST store nothing
and MUST start no git call. A project and a working directory are separate
settings, so a named repository or checkout MUST NOT need a link in the named
project.

#### Scenario: A worktree checkout cannot be the source

- **WHEN** the request names a `checkoutId` of a worktree row
- **THEN** the response is 422 and nothing is stored

#### Scenario: A disagreeing repository id is rejected

- **WHEN** the request names a `checkoutId` and a `repositoryId` of another
  repository
- **THEN** the response is 422 and nothing is stored

#### Scenario: A disagreeing executor id is rejected

- **WHEN** the request names a `checkoutId` and an `executorId` of another
  executor
- **THEN** the response is 422 and nothing is stored

#### Scenario: A checkout of an unlinked repository starts in the project

- **WHEN** the request names a `projectId` and a `checkoutId` whose repository
  the project does not link
- **THEN** the chat is filed into the project and binds that checkout

### Requirement: A create request with a message validates it before any write

When the request carries `message`, that field MUST be `CreateChatMessageDto`
(`id`, `parts`, `modelId`, optional `effort` and `permissionMode`). It MUST
compose the message-parts schema and MUST NOT reuse `CreateMessageBodyDto`. The
server MUST validate the message before the first write. It MUST check the
model, the effort, the permission mode, the parts, and the media ownership. A
failed check MUST answer as the message route does and MUST store nothing.

#### Scenario: An unavailable model stores nothing

- **WHEN** the request names an unavailable model
- **THEN** the response is 422 and no chat, bound root, or message is stored

#### Scenario: A media part of another owner stores nothing

- **WHEN** the request carries a media part that belongs to another owner
- **THEN** the response is 400 and no chat, bound root, or message is stored

### Requirement: Creation runs its steps in one fixed order

The server MUST validate the message, the named ids, `worktree.name`, and
`baseRef` before any write. An invalid value MUST answer 422. It MUST then store
the chat, authorize the Workspace, and create the requested worktree. The server
MUST then store the message and enqueue the Run. It MUST NOT enqueue a Run
before the message and the bound root are stored. The request's `worktree` field
MUST decide worktree creation.

#### Scenario: The first Run starts after the binding is stored

- **WHEN** every step succeeds for a request with a `worktree`
- **THEN** the worktree exists before the bound root is stored
- **AND** the first Run starts with the worktree bound root in place

#### Scenario: A request without a worktree binds the checkout

- **WHEN** the request omits `worktree` and the checkout resolves
- **THEN** the server binds the checkout and starts no worktree command

#### Scenario: An invalid worktree argument stores nothing

- **WHEN** the request sets `worktree.name` to `-bad` or `baseRef` to `--force`
- **THEN** the response is 422 before any write and no worktree command starts

### Requirement: The bind step refuses a chat that holds a message or a Run

The step that stores the bound root MUST store it only when the chat holds no
message and no Run. Otherwise the create MUST answer 409 and store no bound
root.

#### Scenario: A chat that holds a message or a Run is not rebound

- **WHEN** the step that stores the bound root runs for a chat that already
  holds a message or a Run
- **THEN** the response is 409 and no bound root is stored

### Requirement: The creation worktree commits with its lease and binding

The worktree checkout row, its lease, and the bound root MUST commit in one
transaction. A failure MUST leave no lease, no checkout row, and no bound root.
The lease MUST carry the chat id and the worktree checkout id, with one row per
chat.

#### Scenario: The creation rows commit together

- **WHEN** the worktree add succeeds and the transaction commits
- **THEN** the checkout row, its lease, and the bound root are stored together
- **AND** the lease names the chat and the worktree checkout

### Requirement: A resend reads the recorded worktree directory

The step MUST record the canonical worktree directory in the chat's creation
attempt before `git.worktreeAdd`. When the add succeeds and the transaction
rolls back, a resend MUST read that directory from the attempt and MUST NOT run
`git.worktreeAdd` again. The resend MUST answer `outcome_unknown` with
`leftDirectory` set to the recorded directory.

#### Scenario: A resend after a rolled-back worktree commit adds no second worktree

- **WHEN** `git.worktreeAdd` succeeded and the transaction rolled back, and the
  owner resends the same chat id
- **THEN** the response is 201 with `workspace.status` `outcome_unknown` and
  `leftDirectory` set to the recorded directory
- **AND** no second `git.worktreeAdd` call runs

### Requirement: Creation serializes requests for one chat id

The server MUST hold a session advisory lock on the chat id through
`pg_try_advisory_lock`. The lock MUST run on one dedicated connection and MUST
be held for the whole request. The server MUST release it at the end of the
request, or when that connection ends. The steps MUST keep their separate
transactions. A request that cannot take the lock MUST answer 409 with `code`
`creation_in_progress` and change nothing. The lock MUST cover the location,
worktree, bound root, and message steps.

#### Scenario: Two concurrent creates with one id create one worktree

- **WHEN** two create requests with one chat id run at the same time
- **THEN** one request stores the chat, its worktree, and its lease
- **AND** the other answers 409 with `code` `creation_in_progress`, and no second
  worktree exists

### Requirement: The message route refuses a chat that a create request holds

`POST /api/v1/chats/:id/messages` MUST try the chat's creation lock in its
admission transaction. When a create request holds that lock, the route MUST
answer 409 with `code` `creation_in_progress`. It MUST store no message and no
Run.

#### Scenario: A message during a create is refused

- **WHEN** a create request holds the lock for a chat id and the owner posts a
  message to that id
- **THEN** the message route answers 409 with `code` `creation_in_progress`
- **AND** no message or Run is stored, and the create continues

### Requirement: The Workspace step uses the request permission mode

The Workspace step MUST use `message.permissionMode`, and `default` when absent.
A `bypass` request on a process whose `tools.permissionModes` does not enable it
MUST answer 422 before any store. The step MUST record each decision in the
chat's creation record.

#### Scenario: bypass on a process without bypass stores nothing

- **WHEN** the request sets `permissionMode` to `bypass` and the process does not
  enable `bypass`
- **THEN** the response is 422 and no chat, bound root, or message is stored

#### Scenario: An enabled bypass applies to every path decision

- **WHEN** the request sets `permissionMode` to `bypass` and the process enables
  `bypass`
- **THEN** every path decision is evaluated in `bypass` mode
- **AND** each decision is recorded in the chat's creation record

### Requirement: The Workspace step requires the entry gates

The step MUST require `enter_workspace` in `tools.allowed`. For a local
executor, `tools.nativeExecutorId` MUST equal the resolved executor id. A
missing allowlist entry MUST answer `bind_failed` with `code`
`tool_not_allowed`. A missing or different native id MUST answer `bind_failed`
with `code` `executor_unavailable`.

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

The step MUST use the `enter_workspace` group in this order. The step MUST
decide the submitted checkout path before any probe. It MUST decide the
canonical source clone before any git call. It MUST decide the main tree from
`git.inspect` after that call when it differs. It MUST decide the canonical
worktree directory before `git.worktreeAdd`. A reject or a missing allow MUST
answer `bind_failed` with `code` `permission_denied`, with no bound root and no
later git call.

#### Scenario: A rejected submitted path stops the creation

- **WHEN** the `enter_workspace` permission group rejects the submitted path
- **THEN** the response is 201 with `workspace.status` `bind_failed` and `code`
  `permission_denied`
- **AND** no worktree command starts, no bound root is stored, and the chat record
  stays

#### Scenario: A rejected source clone stops the creation before any git call

- **WHEN** the submitted path is allowed and the canonical source clone is
  rejected
- **THEN** the response is 201 with `workspace.status` `bind_failed` and `code`
  `permission_denied`
- **AND** no git call runs and no bound root is stored

#### Scenario: A rejected worktree directory stops the creation before the add

- **WHEN** the first two decisions allow and the canonical worktree directory is
  rejected
- **THEN** the response is 201 with `workspace.status` `bind_failed` and `code`
  `permission_denied`
- **AND** no `git.worktreeAdd` call runs and no bound root is stored

### Requirement: The response workspace object has one closed status set

The `workspace` object MUST carry `status`. It can also carry `root`,
`executorId`, `worktree` (`path`, `branch`, `baseCommit`), `code`, `message`,
and `leftDirectory`. `status` MUST be one of `bound`, `unbound`, `bind_failed`,
`worktree_failed`, `machine_unavailable`, `machine_update_required`, or
`outcome_unknown`. `code` MUST appear only with `bind_failed` or
`worktree_failed`. `leftDirectory` MUST name a directory that `outcome_unknown`
can leave behind, when known.

#### Scenario: A bound start names its location

- **WHEN** the Workspace step binds the worktree
- **THEN** `workspace.status` is `bound`
- **AND** `root`, `executorId`, and `worktree` name the root, the executor, the
  path, the branch, and the base commit

#### Scenario: An unbound start names no root

- **WHEN** no location resolves
- **THEN** `workspace.status` is `unbound` and `workspace.root` is absent

### Requirement: An unresolved location stores the message and starts the Run

When the request carries `message` and no location resolves, the server MUST
store the chat and the message. It MUST start the Run. It MUST answer 201 with
`workspace.status` `unbound`. When the request carries no `message`, the server
MUST store the chat only, and it MUST start no Run.

#### Scenario: A start without a location still sends

- **WHEN** the project links a repository and the request names no location
- **THEN** the chat and the message are stored and the Run starts
- **AND** the response is 201 with `workspace.status` `unbound`

#### Scenario: An unbound start without a message starts no Run

- **WHEN** the request names no location and omits `message`
- **THEN** the chat is stored, and no message and no Run are stored
- **AND** the response is 201 with `workspace.status` `unbound`

### Requirement: Failure statuses name their cause

A path outside the Machine's registered roots MUST answer `worktree_failed` with
`code` `path_not_registered`. Any other git failure MUST answer
`worktree_failed` with no `code`. `message` MUST carry the bounded, redacted git
standard error that the `repositories` change returns. A source that is not a
directory MUST answer `bind_failed` with `code` `not_found`. A Machine link lost
after the add MUST answer `outcome_unknown`. A daemon without a git method MUST
answer `machine_update_required`.

#### Scenario: A worktree path outside the registered roots fails

- **WHEN** the Machine refuses the worktree directory as `path_not_registered`
- **THEN** the response is 201 with `workspace.status` `worktree_failed` and
  `code` `path_not_registered`
- **AND** the chat stays filed and unbound and the message is not stored

#### Scenario: A git failure carries its standard error

- **WHEN** the worktree command fails and the Machine's roots refuse nothing
- **THEN** the response is 201 with `workspace.status` `worktree_failed`, no
  `code`, and `message` set to the bounded, redacted git standard error that the
  `repositories` change returns

#### Scenario: A lost Machine link leaves an unknown outcome

- **WHEN** the Machine link is lost after the worktree add was sent
- **THEN** the response is 201 with `workspace.status` `outcome_unknown`
- **AND** `leftDirectory` names the directory that can remain, when known

#### Scenario: An outdated daemon refuses the start

- **WHEN** the Machine handshake lists no git method
- **THEN** the response is 201 with `workspace.status` `machine_update_required`
- **AND** no git request is sent and the message is not stored

### Requirement: A failed workspace leaves the chat filed and unbound

If the Workspace step or the worktree creation fails, the server MUST keep the
stored chat and its project. It MUST store no bound root, no defaults row, and
no lease. It MUST NOT store the message or enqueue the Run. It MUST answer 201
with the failure `status` and, when that status carries one, its `code`. The
client MUST keep the message for a later send.

#### Scenario: Worktree creation fails

- **WHEN** the worktree command fails
- **THEN** the response is 201 with `workspace.status` `worktree_failed`
- **AND** the chat stays filed and unbound, the message is not stored, and no
  Run starts

#### Scenario: Binding fails after the path decisions

- **WHEN** the Workspace step fails after the path decisions
- **THEN** the response is 201 with `workspace.status` `bind_failed`
- **AND** the chat stays filed and unbound, and the message is not stored

### Requirement: A failed defaults write does not fail the create

A failed defaults write is not a failed workspace. That write runs after the
commit, it is best-effort, and the last write wins. Its failure MUST NOT fail
the create and MUST NOT change the response, the bound root, the message, or
the Run. The previous defaults row MUST stay.

#### Scenario: A failed defaults write keeps the successful start

- **WHEN** the defaults write fails after the bound root commits
- **THEN** the response is 201 with `workspace.status` `bound`
- **AND** the bound root, the message, and the Run stay, and the previous
  defaults row stays

### Requirement: The message step commits the message and its Run before the enqueue

The server MUST insert the message and its Run row in one transaction, and MUST
enqueue the Run after that commit. An enqueue failure MUST fail the Run and
answer 5xx. The message and the Run row MUST stay stored, and so MUST the chat
and the bound root. The failed Run MUST free the single-flight slot. A later
create request with the same chat id MUST answer 409. The client MUST then send
the draft again as a new message, with a new `message.id`, through
`POST /api/v1/chats/:id/messages`.

#### Scenario: An enqueue failure keeps the message and its Run

- **WHEN** the enqueue fails after the message and the Run row commit
- **THEN** the response is 5xx and the message and the failed Run stay stored
- **AND** the chat and the bound root stay stored

#### Scenario: A create resend after an enqueue failure is a conflict

- **WHEN** the owner resends the same chat id after an enqueue failure
- **THEN** the request fails with 409
- **AND** the owner sends the draft as a new message with a new id through the
  message route, and a new Run starts

### Requirement: A resent create request reuses the stored chat and its binding

A same-owner create request with a stored chat id MUST reuse that chat and run
the message validation and message step. It MUST NOT create a second chat,
worktree, lease, or bound root. A stored bound root MUST stay unchanged. A chat
with no bound root and no recorded worktree attempt MUST run the location,
worktree, and bound root steps. A chat with a creation lease MUST reuse that
worktree and bound root.

#### Scenario: A resend after a failed workspace binds the corrected location

- **WHEN** the first request answered `bind_failed`, no creation lease exists,
  and the owner resends the same chat id with a corrected location
- **THEN** the server re-runs the location steps and answers 201 with
  `workspace.status` `bound`
- **AND** the message is stored and the Run starts

#### Scenario: A worktree resend with a message reuses the worktree

- **WHEN** the first request carried `worktree` and no `message`, or failed before it stored a message, and stored a creation lease
- **AND** the owner resends that chat id with `worktree` and a message
- **THEN** the server reuses that worktree and bound root and creates no second
  worktree
- **AND** the message is stored and the Run starts

#### Scenario: A resend keeps a binding that has no lease

- **WHEN** the chat is bound to a main checkout with no creation lease, and the
  owner resends the same chat id with another location
- **THEN** the stored bound root stays unchanged and no worktree command starts
- **AND** the message is stored and the Run starts

#### Scenario: A resend of a chat with a message is a conflict

- **WHEN** the stored chat already holds a message and the owner resends the
  same chat id
- **THEN** the request fails with 409 and the stored chat is unchanged

### Requirement: A resend refuses an archived chat or another project

A resend on an archived chat MUST answer 409 and change nothing. A resend whose
`projectId` differs from the stored chat's project MUST answer 409 with `code`
`project_mismatch`. A chat id of another owner MUST answer 404 and disclose no
field of that chat.

#### Scenario: An archived chat refuses the resend

- **WHEN** the owner archives the chat after a failed create and resends the same
  chat id
- **THEN** the request fails with 409 and the archived chat is unchanged

#### Scenario: A resend into another project is a mismatch

- **WHEN** the owner resends a stored chat id with a different `projectId`
- **THEN** the request fails with 409 with `code` `project_mismatch`
- **AND** the stored chat keeps its project

#### Scenario: A stored id of another owner is not found

- **WHEN** a user sends a chat id that is stored for a different owner
- **THEN** the request fails with 404 and no chat is created
- **AND** the response discloses no field of the other owner's chat

### Requirement: The owner previews the start location without effects

`GET /api/v1/projects/:id/start-location` MUST accept `repositoryId`,
`executorId`, and `checkoutId`. It MUST resolve them in the create request's
order and with its validation. With no ids, it MUST resolve the project's
suggested location from the primary link, the single link, and the remembered
defaults. It MUST return the resolved repository, executor, checkout, and the
isolation default with its reason. It MUST write nothing and MUST start no git
call. Only the project owner MUST read it.

#### Scenario: The preview names the location that a named create binds

- **WHEN** the owner previews the start location with no ids and then creates a
  chat that names the previewed repository, executor, and checkout
- **THEN** the create binds the checkout that the preview named
- **AND** the preview stores no defaults row

#### Scenario: Another owner cannot read the preview

- **WHEN** a user previews the start location of another owner's project
- **THEN** the response is 404

### Requirement: A create binds the suggested location only when it names it

A create MUST NOT bind the location that the preview suggests unless the
request names it.

#### Scenario: A create without ids does not bind the suggestion

- **WHEN** the preview with no ids names a checkout and the owner creates a chat
  on the same project with no ids
- **THEN** `workspace.status` is `unbound`

### Requirement: Chat creation is owner-isolated

The server MUST derive the owner from the session and store the chat under that
owner. It MUST validate `projectId`, `repositoryId`, and `checkoutId` under
owner row-level security. The check MUST run in the same transaction as the chat
insert and MUST precede it. A foreign or missing id MUST answer 404 and store
nothing. An archived project MUST answer 409 and store nothing.

#### Scenario: A foreign project is not found

- **WHEN** owner A sends a request with a project id of owner B
- **THEN** the request fails with 404 and no chat is stored

#### Scenario: A foreign checkout is not found

- **WHEN** the request names a checkout that belongs to another owner
- **THEN** the request fails with 404 and no chat or bound root is stored

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

`POST /api/v1/chats/:id/messages` MUST keep its current behavior, except the
refusal while a create request holds the chat's creation lock. A first message
to an unknown chat id MUST create a chat with no project and no bound root. A
message to a stored chat MUST NOT change its project or its bound root.
`PATCH /api/v1/chats/:id` MUST continue to file a chat.

#### Scenario: A first message creates an unfiled chat

- **WHEN** a client posts a first message for an unknown chat id
- **THEN** the chat is stored with no project and no bound Workspace root

#### Scenario: Filing stays a separate request

- **WHEN** the owner files the chat with `PATCH /api/v1/chats/:id`
- **THEN** the chat gains the project and no Workspace change of the bound roots
