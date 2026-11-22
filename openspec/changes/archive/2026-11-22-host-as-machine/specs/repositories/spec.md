## MODIFIED Requirements

### Requirement: A Machine checkout stores the canonical Machine locator

Every checkout MUST store the canonical Machine locator `machine://<name>/<absolute path>` and the Machine name as its executor identifier. This MUST apply to a checkout on the host Machine. The form MUST be the same as the stored Workspace root of a chat.

#### Scenario: A Machine checkout names its Machine

- **WHEN** the owner registers the path `machine://nas/srv/app`
- **THEN** the checkout records the executor identifier `nas` and the path `machine://nas/srv/app`

#### Scenario: A Machine checkout path equals a binding root

- **WHEN** a chat binds `machine://nas/srv/app` and the owner registers `machine://nas/srv/app`
- **THEN** the checkout path is `machine://nas/srv/app`
- **AND** the checkout lists that chat as bound to it

#### Scenario: A host checkout stores a Machine locator

- **WHEN** `machines.default` is the host Machine `devl` and the owner registers the path `/home/me/llame`
- **THEN** the checkout records the executor identifier `devl` and the path `machine://devl/home/me/llame`

### Requirement: A main checkout can carry a worktree base directory

A `main` checkout can carry a worktree base directory. The owner MUST set it with `PATCH /api/v1/checkouts/:id` and a `worktreeBase` field.

The value MUST be on the Machine of that main checkout: a `machine://<same name>/` locator, or an absolute path when that Machine is `machines.default`. The system MUST store it as the canonical Machine locator. A value on another Machine MUST fail with status 422. A `worktree` row MUST refuse `worktreeBase`.

#### Scenario: A main checkout can set a worktree base directory

- **WHEN** the owner sets a worktree base directory on a `main` checkout
- **THEN** a new worktree of that checkout is created under that directory

#### Scenario: A relative worktree base is refused

- **WHEN** the owner submits `worktreeBase` `trees/llame`
- **THEN** the request fails with status 422 and changes no row

#### Scenario: A worktree base on another executor is refused

- **WHEN** the owner submits `worktreeBase` `machine://nas/srv/trees` for a `main` checkout on `devl`
- **THEN** the request fails with status 422 and changes no row

#### Scenario: A worktree row refuses a worktree base

- **WHEN** the owner submits `worktreeBase` for a `worktree` checkout
- **THEN** the request fails with status 422 and changes no row

### Requirement: Registration and removal need a configured executor

Registration and removal MUST derive a configured Machine. An absolute path MUST use `machines.default`. Without `machines.default`, an absolute path MUST fail with `executor_unavailable` and status 503. A locator MUST name a configured Machine. A locator that names no configured Machine MUST fail with `executor_unavailable` and status 503. In each failure, no git method MUST start, and the system MUST store no row.

#### Scenario: A Machine that is not configured is refused

- **WHEN** the owner registers `machine://ghost/srv/app` and no Machine named `ghost` is configured
- **THEN** the request fails with `executor_unavailable` and stores no row

#### Scenario: A process without a native executor refuses a local path

- **WHEN** the owner registers the absolute path `/srv/app` and the configuration has no `machines.default`
- **THEN** the request fails with `executor_unavailable` and status 503
- **AND** no git method starts and the system stores no row

### Requirement: Executors expose typed git operations

Each Machine daemon, the host Machine daemon included, MUST offer `git.inspect`, `git.worktreeAdd`, `git.worktreeList`, `git.worktreeRemove`, `git.locate`, and `git.state`. The installation MUST NOT run git in process for a checkout or a Workspace. Each call MUST take typed input and MUST use a timeout. Each method that starts git MUST pass git an argument vector and use a fixed environment. Each git failure MUST return a typed result with the git standard error.

#### Scenario: Owner input reaches git as one argument

- **WHEN** the owner registers a path that holds a `;` character
- **THEN** the Machine daemon receives one argument and starts no shell

#### Scenario: A slow operation stops at the timeout

- **WHEN** a git operation does not end within its timeout
- **THEN** the call ends and returns a typed failure, and no row is stored

#### Scenario: Locate starts no git process

- **WHEN** the system calls `git.locate` on a directory inside a clone
- **THEN** the result names the nearest `.git` entry, and no git process starts

#### Scenario: Host git runs through the host Machine daemon

- **WHEN** the owner registers `/home/me/llame` on the host Machine `devl` and the `devl` Machine daemon cannot start
- **THEN** the request fails with `machine_unavailable`
- **AND** no git process starts in the worker or the API process
