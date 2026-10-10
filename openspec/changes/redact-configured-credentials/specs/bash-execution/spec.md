## MODIFIED Requirements

### Requirement: Command results are bounded and explicit

Each bash call SHALL enforce finite input, duration, process, stdout, and stderr
bounds. The result SHALL contain a safe status, exit code when known, bounded
output, and truncation metadata when output is limited. The executor SHALL
return output as the command produced it, cut at the bound, without rewriting,
reordering, or deleting lines, except that every member of the instance's
configured credential set (`instance-config`) SHALL be replaced with
`[REDACTED]` before the result leaves the executor. The bound SHALL be
applied to the raw output's positions without splitting a member match, and
a fragment at a forced stream close that is a proper prefix of a member SHALL be
dropped; no cut or drop SHALL expose any part of a member match. Secrets a
bound Workspace's own MCP configuration resolves are not members. The
delimiter neutralization
every model-facing tool result receives SHALL still apply to the copy the model
reads. After timeout settlement proves the process group stopped, the watcher
SHALL drain output for at most 50 ms; a stream still open at that bound SHALL be
marked truncated and destroyed.

#### Scenario: Oversized output is bounded

- **WHEN** a command produces more output than the configured result bound
- **THEN** the result contains a bounded prefix and explicit truncation metadata
- **AND** excess output is not sent to the model

#### Scenario: Non-zero exit is observable

- **WHEN** a command exits non-zero within its bounds
- **THEN** the result reports the non-zero status and bounded stderr
- **AND** it does not convert the command into a successful file or Knowledge effect

#### Scenario: Paths and diagnostics survive

- **WHEN** a command prints absolute paths, a stack trace, or a line beginning
  with `Error:`
- **THEN** the executor result contains those lines verbatim within the bound
- **AND** only reserved tool delimiters are escaped in the copy the model reads

#### Scenario: A printed provider key is redacted

- **WHEN** a provider `key` resolves to `sk-canary-1065` and a bash command prints a file containing it
- **THEN** the result's stdout contains `[REDACTED]` where the key was
- **AND** the recorded result and its replay contain no `sk-canary-1065`

#### Scenario: A credential crossing the output bound is redacted whole

- **WHEN** a command prints output whose configured credential begins a few characters before the stdout bound
- **THEN** the result contains no prefix of the credential
- **AND** the result is still bounded and marked truncated

#### Scenario: An earlier redaction does not expose a later credential

- **WHEN** a command prints a configured credential longer than `[REDACTED]` near the start of stdout and a second, the longest member, beginning just past the stdout bound
- **THEN** the result contains `[REDACTED]` for the first and no prefix of the second

#### Scenario: A credential ending at the cut is redacted whole

- **WHEN** a configured credential crosses the stdout bound and its last character is the first character of another member
- **THEN** the result contains `[REDACTED]` for it and no part of it

#### Scenario: Non-credential configuration survives

- **WHEN** `knowledge.root` resolves to `/srv/kb` and a command prints `/srv/kb/notes.md`
- **THEN** the result contains `/srv/kb/notes.md` verbatim
