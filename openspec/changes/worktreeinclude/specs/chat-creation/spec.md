# Chat creation environment

## ADDED Requirements

### Requirement: Chat creation copies the environment before its first binding

A Chat-creation Worktree MUST complete the `worktree-includes` copy before the
Checkout, lease, and bound root commit. The message and first Run MUST follow
that commit. Existing source Checkout restrictions MUST remain unchanged. A
request without Worktree creation MUST NOT process `.worktreeinclude`.

#### Scenario: The first Run sees a complete environment

- **WHEN** an admitted Chat-creation request asks for a Worktree and an initial message
- **THEN** the selected environment files exist before the bound root commits
- **AND** the first Run starts only after that commit

#### Scenario: Binding a main Checkout does not seed it

- **WHEN** Chat creation binds a Checkout without a Worktree request
- **THEN** it copies no manifest-selected files

### Requirement: A failed creation copy preserves the Chat without a binding

A known copy failure MUST return `workspace.status` `worktree_failed` and the
known `leftDirectory`. The Chat MUST remain filed and unbound. The request MUST
store no new Checkout, lease, message, or Run. It MUST retain its recorded
creation directory and MUST NOT automatically remove the partial Worktree.

#### Scenario: Copy failure starts no first Run

- **WHEN** the copy fails after creation of the new Worktree
- **THEN** the response retains the Chat with `workspace.status` `worktree_failed`
- **AND** `leftDirectory` names the retained directory
- **AND** no message, Run, lease, or new Checkout exists

### Requirement: Creation recovery never repeats a recorded environment copy

The creation attempt MUST record the destination before checkout or copy. A
resend after an incomplete recorded creation MUST reuse its recorded-directory
recovery rule. It MUST return `outcome_unknown` with `leftDirectory` rather than
repeat checkout or copy. A completed binding MUST NOT trigger a fresh copy.

#### Scenario: A resend after partial copy does not recopy

- **WHEN** the owner resends the same Chat id after a partial copy failure
- **THEN** the response returns `outcome_unknown` with the recorded `leftDirectory`
- **AND** checkout and copy do not run again

#### Scenario: Foreign Checkout identity cannot authorize copying

- **WHEN** Chat creation names another owner's Checkout id
- **THEN** the existing ownership check refuses the request
- **AND** no manifest access or copy starts

## MODIFIED Requirements

### Requirement: The response workspace object has one closed status set

The `workspace` object MUST carry `status`. It can also carry `root`,
`executorId`, `worktree` (`path`, `branch`, `baseCommit`), `code`, `message`,
and `leftDirectory`. `status` MUST be one of `bound`, `unbound`, `bind_failed`,
`worktree_failed`, `machine_unavailable`, `machine_update_required`, or
`outcome_unknown`. `code` MUST appear only with `bind_failed` or
`worktree_failed`. For `outcome_unknown` or a known copy failure,
`leftDirectory` MUST name the potential leftover directory when known.

#### Scenario: A bound start names its location

- **WHEN** the Workspace step binds the Worktree
- **THEN** `workspace.status` is `bound`
- **AND** `root`, `executorId`, and `worktree` name the root, executor, path, branch, and base commit

#### Scenario: An unbound start names no root

- **WHEN** no location resolves
- **THEN** `workspace.status` is `unbound` and `workspace.root` is absent

#### Scenario: A known copy failure names its leftover

- **WHEN** a known copy failure retains a Worktree at a known directory
- **THEN** `workspace.status` is `worktree_failed` and `leftDirectory` names that directory

### Requirement: Failure statuses name their cause

A path outside the Machine's registered roots MUST answer `worktree_failed` with
`code` `path_not_registered`. Any other git failure MUST answer
`worktree_failed` with no `code`. `message` MUST carry the bounded, redacted git
standard error that the `repositories` change returns. A failed environment copy
MUST answer `worktree_failed` with no `code` and a `message` that is a fixed
reason phrase plus at most one bounded relative path, never standard error, OS
error text, manifest lines, or file bytes. A source that is not a
directory MUST answer `bind_failed` with `code` `not_found`. A Machine link lost
after the add MUST answer `outcome_unknown`. A daemon that reports another
protocol version or answers a git method with UNIMPLEMENTED MUST answer
`machine_update_required`.

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

- **WHEN** the Machine daemon reports another protocol version at the handshake
- **THEN** the response is 201 with `workspace.status` `machine_update_required`
- **AND** no git request is sent and the message is not stored

#### Scenario: A daemon without the git method refuses the start

- **WHEN** the Machine daemon answers a git request with UNIMPLEMENTED
- **THEN** the response is 201 with `workspace.status` `machine_update_required`
- **AND** no further git request is sent and the message is not stored

#### Scenario: A copy failure carries a fixed message

- **WHEN** the environment copy fails on `config/secret.env` after the Worktree add
- **THEN** the response is 201 with `workspace.status` `worktree_failed` and no `code`
- **AND** `message` is a fixed reason phrase plus `config/secret.env`, with no standard error, OS error text, manifest line, or file bytes
- **AND** the chat stays filed and unbound and the message is not stored
