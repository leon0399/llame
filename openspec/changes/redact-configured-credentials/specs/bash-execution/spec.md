## MODIFIED Requirements

### Requirement: Command results are bounded and explicit

Each bash call MUST enforce finite input, duration, process, stdout, and
stderr bounds. On the llame host and for an `ssh://` command, each stream
bound MUST be `tools.artifacts.maxBytes` UTF-8 bytes. A Machine command MUST
keep the 32,000-unit stream bound of the Machine protocol. The result MUST
contain a safe status, the exit code when known, the bounded output, and
truncation metadata when a bound cut the output. It MUST carry the wall time
from spawn to settlement as `wallTimeMs` when the producer reports it. The
result MUST NOT carry constant fields that name the operation or the executor.

A `command_failed` message MUST carry the exit code, the elapsed time when
known, and the bounded streams in the bash text shape of
`tool-result-rendering`. A `timed_out` message MUST name the elapsed time that
the producer measured. It MUST omit that time when no command started.

The executor MUST return output as the command produced it, cut at the bound.
The executor MUST NOT rewrite, reorder, or delete lines, except to replace a
member and to drop a required fragment. llame MUST replace
every member of the instance's configured credential set (`instance-config`)
with `[REDACTED]`. The replacement MUST occur before llame records the result,
stores it as an artifact, or sends it to the model.

On the llame host the executor redacts. For an `ssh://` command and a Machine
command, the API redacts the output it received. llame never sends the
configured credential set to the remote host or the Machine.

The executor MUST apply the bound to the raw output's positions in the bound's
own unit, and a stream MUST NOT exceed the bound. If the bound clips a member,
llame MUST replace a fragment of 10 or more characters with `[REDACTED]`.
llame MUST remove a shorter fragment. llame can cut a stream at a
capture or transport limit, or because the command timed out. In that case
llame MUST drop the fragment at the end that is a proper prefix of a member.

When a transport dropped output between two kept parts of a stream, a member
fragment can match on both sides of that gap. llame MUST drop both fragments.
A cut, a drop, or a gap MUST NOT expose any part of a member match.

Secrets that a bound Workspace's own MCP configuration resolves are not
members. The delimiter neutralization of every tool result MUST still apply to
the copy that the model reads. After timeout settlement proves that the
process group stopped, the watcher MUST drain output for at most 50 ms. The
watcher MUST mark a stream that is still open at that bound as truncated, and
MUST destroy it.

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

- **WHEN** the deadline stops a command after 30.0 s
- **THEN** the `timed_out` message names 30.0 s elapsed

#### Scenario: An old daemon reports no wall time

- **WHEN** a Machine daemon that predates `wallTimeMs` answers a bash call
- **THEN** the hub result carries no `wallTimeMs`
- **AND** the call settles with its other fields unchanged

#### Scenario: A host stream within the default bound is kept

- **WHEN** `tools.artifacts.maxBytes` is its default 8 MiB and a command on the llame host prints 3 MB to stdout
- **THEN** the executor keeps all 3 MB, and the result is not marked truncated

#### Scenario: A printed provider key is redacted

- **WHEN** a provider `key` resolves to `sk-canary-7Qx2Lm9Vb4Rt8Wn3` and a file holds that key. A bash command on the llame host prints that file
- **THEN** the result's stdout contains `[REDACTED]` where the key was
- **AND** the recorded result, its artifact, and its replay contain no `sk-canary-7Qx2Lm9Vb4Rt8Wn3`

#### Scenario: Remote output is redacted by the API

- **WHEN** an `ssh://` command or a Machine command writes a configured credential to its output
- **THEN** the recorded result contains `[REDACTED]` where the credential was and not the credential
- **AND** no member of the set was sent to the remote host or the Machine

#### Scenario: A credential crossing the output bound is redacted whole

- **WHEN** a command on the llame host prints output whose configured credential begins a few characters before the stdout bound
- **THEN** the result contains no prefix of the credential
- **AND** the result is still bounded and marked truncated

#### Scenario: An earlier redaction does not expose a later credential

- **WHEN** a command prints a configured credential longer than `[REDACTED]` near the start of stdout. The longest member then begins just past the stdout bound
- **THEN** the result contains `[REDACTED]` for the first and no prefix of the second

#### Scenario: A credential ending at the cut is not exposed

- **WHEN** a configured credential crosses the stdout bound and its last character is the first character of another member
- **THEN** the result contains no part of it

#### Scenario: A credential cut by the timeout is not exposed

- **WHEN** a command times out while it prints a configured credential
- **THEN** the result contains no prefix of the credential

#### Scenario: A credential cut by a Machine's bound is not exposed

- **WHEN** a Machine command's stdout reaches the 32,000-unit bound in the middle of a configured credential
- **THEN** the hub result contains no prefix of the credential
- **AND** the result is marked truncated

#### Scenario: A short fragment at the bound leaves no marker

- **WHEN** a configured credential starts 4 characters before the stdout bound
- **THEN** the result's stdout ends before the credential and is no longer than the bound
- **AND** it contains no character of the credential

#### Scenario: Non-credential configuration survives

- **WHEN** `knowledge.root` resolves to `/srv/kb` and a command prints `/srv/kb/notes.md`
- **THEN** the result contains `/srv/kb/notes.md` verbatim
