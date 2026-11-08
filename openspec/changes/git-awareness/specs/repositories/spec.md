# Spec Delta

## MODIFIED Requirements

### Requirement: Executors expose typed git operations

Each executor MUST offer `git.inspect`, `git.worktreeAdd`, `git.worktreeList`,
`git.worktreeRemove`, `git.locate`, and `git.state`. The local executor MUST
offer the same methods. Each call MUST take typed input and MUST pass git an
argument vector. Each call MUST use a fixed environment and a timeout. Each
failure MUST return a typed result with the git standard error.

#### Scenario: Owner input reaches git as one argument

- **WHEN** the owner registers a path that holds a `;` character
- **THEN** the executor receives one argument and starts no shell

#### Scenario: A slow operation stops at the timeout

- **WHEN** a git operation does not end within its timeout
- **THEN** the call ends and returns a typed failure, and no row is stored

#### Scenario: Worktree removal reads the state method

- **WHEN** the owner removes a worktree that holds uncommitted changes
- **THEN** the guard reads the change state through `git.state` and refuses the removal
