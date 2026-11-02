## MODIFIED Requirements

### Requirement: Command results are bounded and explicit

Each bash call MUST enforce finite input, duration, process, stdout, and
stderr bounds. On the llame host and for an `ssh://` command, each stream
bound MUST be `tools.artifacts.maxBytes` UTF-8 bytes. A Machine command MUST
keep the 32,000-unit stream bound of the Machine protocol. The result MUST contain a safe status, the exit
code when known, the bounded output, and truncation metadata when a bound cut
the output. It MUST carry the wall time from spawn to settlement as
`wallTimeMs` when the producer reports it. The result MUST NOT carry constant
fields that name the operation or the executor.

A `command_failed` message MUST carry the exit code, the elapsed time when
known, and the bounded streams in the bash text shape of
`tool-result-rendering`. A `timed_out` message MUST name the elapsed time that
the producer measured. It MUST omit that time when no command started.

The executor MUST return output as the command produced it, cut at the bound.
It MUST NOT rewrite, reorder, or delete lines. The executor MUST redact values
that the host knows to be secret before the result leaves it. The delimiter
neutralization of every tool result MUST still apply to the copy that the model
reads. After timeout settlement proves that the process group
stopped, the watcher MUST drain output for at most 50 ms. The watcher MUST
mark a stream that is still open at that bound as truncated, and MUST destroy
it.

#### Scenario: Oversized output is bounded

- **WHEN** a command on the llame host produces more output than `tools.artifacts.maxBytes`
- **THEN** the result contains a bounded prefix and explicit truncation metadata
- **AND** the output after that bound reaches neither the model nor the artifact

#### Scenario: Non-zero exit is observable

- **WHEN** a command exits non-zero within its bounds
- **THEN** the result reports the non-zero status and bounded stderr
- **AND** it does not convert the command into a successful file or Knowledge effect

#### Scenario: Paths and diagnostics survive

- **WHEN** a command prints absolute paths, a stack trace, or a line that begins with `Error:`
- **THEN** the executor result contains those lines verbatim within the bound
- **AND** only reserved tool delimiters are escaped in the copy that the model reads

#### Scenario: Wall time is reported

- **WHEN** a command runs for 1,240 ms and exits 0
- **THEN** the result carries `wallTimeMs` 1240
- **AND** the header that the model reads is `exit 0, 1.2 s`

#### Scenario: A timeout names the elapsed time

- **WHEN** a command is stopped by its deadline after 30.0 s
- **THEN** the `timed_out` message names 30.0 s elapsed

#### Scenario: An old daemon reports no wall time

- **WHEN** a Machine daemon that predates `wallTimeMs` answers a bash call
- **THEN** the hub result carries no `wallTimeMs`
- **AND** the call settles with its other fields unchanged

#### Scenario: A host stream larger than the old bound is kept

- **WHEN** a command on the llame host prints 3 MB to stdout
- **THEN** the executor keeps all 3 MB, and the result is not marked truncated
