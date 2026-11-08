# Spec Delta

## MODIFIED Requirements

### Requirement: Executors expose typed git operations

Each executor MUST offer `git.inspect`, `git.worktreeAdd`, `git.worktreeList`,
`git.worktreeRemove`, `git.locate`, and `git.state`. The local executor MUST
offer the same methods. Each call MUST take typed input and MUST use a timeout.
Each method that starts git MUST pass git an argument vector and use a fixed
environment. Each git failure MUST return a typed result with the git standard
error.

#### Scenario: Owner input reaches git as one argument

- **WHEN** the owner registers a path that holds a `;` character
- **THEN** the executor receives one argument and starts no shell

#### Scenario: A slow operation stops at the timeout

- **WHEN** a git operation does not end within its timeout
- **THEN** the call ends and returns a typed failure, and no row is stored

#### Scenario: Locate starts no git process

- **WHEN** the system calls `git.locate` on a directory inside a clone
- **THEN** the result names the nearest `.git` entry, and no git process starts

## ADDED Requirements

### Requirement: Worktree removal reads a complete worktree state

The removal guard MUST treat a gone upstream as an unknown upstream. It MUST
count changes inside a submodule as uncommitted changes. It MUST refuse removal
when it cannot read the worktree state.

#### Scenario: A gone upstream fails closed

- **WHEN** the upstream of the worktree branch was deleted and pruned, and HEAD is not the recorded base commit
- **THEN** the request fails, and the directory and the row remain

#### Scenario: A dirty submodule keeps the worktree

- **WHEN** the worktree is clean except for uncommitted changes inside a submodule
- **THEN** the request fails, and the directory and the row remain

#### Scenario: An unreadable state keeps the worktree

- **WHEN** the guard cannot read the worktree state because git fails or times out
- **THEN** the request fails, and the directory and the row remain

#### Scenario: Worktree removal reads the state method

- **WHEN** the owner removes a worktree that holds uncommitted changes
- **THEN** the guard reads the change state through `git.state` and refuses the removal
