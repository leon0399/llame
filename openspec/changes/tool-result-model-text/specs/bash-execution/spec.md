# Spec Delta

## MODIFIED Requirements

### Requirement: Command results are bounded and explicit

Each bash call MUST enforce finite input, duration, process, stdout, and stderr bounds. The result
MUST contain a safe status, the exit code when known, bounded output, and truncation metadata when
output is limited. It MUST carry the wall time from spawn to settlement as `wallTimeMs` when the
producer reports it. The result MUST NOT carry constant fields that name the operation or the
executor. A `command_failed` message MUST carry the exit code, the elapsed time when known, and
the bounded streams in the bash text shape of `tool-result-rendering`. A `timed_out` message MUST
name the elapsed time the producer measured, and MUST omit it when no command started. The
executor MUST return output as the command produced it, cut at the bound, without a rewrite, a
reorder, or a deletion of lines. Values the host knows to be secret MUST be redacted before the
result leaves the executor. The delimiter neutralization every model-facing
tool result receives MUST still apply to the copy the model reads. After timeout settlement proves
the process group stopped, the watcher MUST drain output for at most 50 ms. A stream still open at
that bound MUST be marked truncated and destroyed.

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

#### Scenario: An old daemon reports no wall time

- **WHEN** a Machine daemon that predates `wallTimeMs` answers a bash call
- **THEN** the hub result carries no `wallTimeMs`
- **AND** the call settles with its other fields unchanged
