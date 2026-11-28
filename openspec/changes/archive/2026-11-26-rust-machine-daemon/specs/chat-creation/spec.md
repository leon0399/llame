## MODIFIED Requirements

### Requirement: Failure statuses name their cause

A path outside the Machine's registered roots MUST answer `worktree_failed` with
`code` `path_not_registered`. Any other git failure MUST answer
`worktree_failed` with no `code`. `message` MUST carry the bounded, redacted git
standard error that the `repositories` change returns. A source that is not a
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
