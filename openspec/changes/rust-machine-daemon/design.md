## Context

This change is a one-shot experimental implementation. Leo reviews the ADRs;
the rest was decided in a grilling session and is recorded here by its
question code. The tickets on the
[execution-layer map](https://github.com/leon0399/llame/issues/1778) hold the
earlier decisions (Q-codes).

## Goals / Non-Goals

**Goals:** parity with the Node daemon for files, grep, git, MCP, roots,
identity, and facts; attach-or-start; the frozen bootstrap service; tier 1
jobs; the connector switch.

**Non-Goals:** Sandbox confinement, daemon-local call policy, a plugin
execution primitive, jobs that survive a daemon restart (tier 2), macOS and
Windows builds, a production image.

## Decisions

| Code | Decision |
|---|---|
| R1 | No image work. The API finds binaries at `apps/machine/dist/<target>/llame-machine` or under `LLAME_MACHINE_BIN_DIR`. |
| R2 | The daemon does I/O, guards, the grep scan, bash, and git. Model-text rendering stays in TypeScript on the API. |
| R3, R4 | Cargo unit tests sit beside the code; behavior tests are cargo integration tests in `apps/machine/tests` that drive the binary over `attach --stdio`. |
| R5, R18 | One TypeScript smoke test proves Connect-ES over `attach --stdio`; it is deleted once connector tests cover every call shape. |
| R6 | State lives in `$XDG_STATE_HOME/llame-machine` (mode 0700): `daemon.sock`, `daemon.lock` (held with `flock`), `jobs/`. |
| R7 | `instance.json` keeps its location and format. |
| R8, R9 | Only `attach --stdio` exists. The connector has no special case for an old daemon. |
| R10 | A restarted daemon settles every unfinished job directory as `lost` and keeps its output readable. |
| R11 | A job directory is deleted only by `Jobs.Release`. A retention backstop is a follow-up. |
| R12 | Existing chunk output is dropped. Every settled job gets one bounded artifact copy. |
| R13 | `Jobs.Watch` sends a snapshot, a marker, then one full record per change. The Machine probe also calls `Jobs.List`. Settlement is idempotent by job id. |
| R14 | The daemon knows only jobs. Foreground, background, and their causes are installation records. |
| R14a | The installation draws a 128-bit job id; a resent start returns the same job. |
| R15 | `rust-toolchain.toml` is authoritative. Strict workspace lints now; `cargo-deny`, CodeQL, fuzzing, and mutation testing later. |
| R16 | Linux only; platform code sits behind `cfg(target_os = "linux")`. |
| R17 | `build` produces the host's static musl target; `build:release` produces x86_64 and aarch64. |
| R20 | Services: `Roots`, `Files`, `Git`, `Jobs`, `Mcp`. |
| R21 | The daemon returns host paths and raw git stderr; the API renders locators. |
| R22 | Every mutating call carries an idempotency key, kept in memory for 10 minutes or 4,096 keys. |
| R23 | Refusals before work are gRPC statuses with an `ErrorInfo` reason; domain outcomes are a `oneof`. |
| R24, R25 | `GetInfo` carries identity, versions, the boot id, facts, and open-string capabilities. `buf breaking` guards the bootstrap package. |
| R26 | At the output ceiling the daemon stops recording and keeps the process running. |
| R27 | `attach` replaces a daemon from another build when it runs no job. |
| R28 | The running-job limit (default 32) and the output ceiling live in the Machine's `config.toml`. |
| R29 | The daemon continues the caller's trace when `SENTRY_DSN` is set (deferred in this attempt). |
| R30 | The connector switch is three layers: connector, host jobs, engine deletion. |
| R31 | The new `machine-daemon` capability owns the daemon contract. |

## Risks / Trade-offs

- The engines are ported, not shared, so rendered text can drift from the
  TypeScript output. Cargo integration tests pin the main cases.
- Tier 1 loses running jobs when the daemon restarts. They settle `lost` with
  their partial output.
- The in-memory idempotency cache does not survive a restart; the call then
  settles as outcome unknown, as before.

## Migration Plan

Operators copy the static binary to each configured Machine, change the SSH
forced command to `llame-machine attach --stdio`, and register roots again
with `llame-machine roots add`. The `chat_job_chunks` migration drops stored
output of existing jobs.
