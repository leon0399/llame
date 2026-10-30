# Spec Delta

## MODIFIED Requirements

### Requirement: Command results are bounded and explicit

Each bash call SHALL enforce finite input, duration, process, stdout, and stderr
bounds. The result SHALL contain a safe status, exit code when known, bounded
output, the wall time from spawn to settlement in milliseconds, and truncation
metadata when output is limited. A `command_failed` or `timed_out` message
SHALL name the elapsed time. The result SHALL NOT carry constant fields that
name the operation or the executor. The executor SHALL
return output as the command produced it, cut at the bound, without rewriting,
reordering, or deleting lines. Values the host knows to be secret SHALL be
redacted before the result leaves the executor. The delimiter neutralization
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

#### Scenario: Wall time is reported

- **WHEN** a command runs for 1,240 ms and exits 0
- **THEN** the result carries `wallTimeMs` 1240
- **AND** the model-facing header reads `exit 0, 1.2 s`

#### Scenario: A timeout names the elapsed time

- **WHEN** a command is stopped by its deadline after 30.0 s
- **THEN** the `timed_out` message names 30.0 s elapsed
