## Why

The Node Machine daemon serves one session per process and runs nothing after
its connection ends. Background jobs on every Machine, attach-or-start, and a
frozen bootstrap service need a daemon that outlives connections and ships as
one static binary per Linux architecture. The decisions are recorded on the
[execution-layer map](https://github.com/leon0399/llame/issues/1778) and in
[The Machine daemon is a Rust binary with a gRPC contract](../../../../docs/adr/2026-11-24-machine-daemon-is-rust-with-grpc-contract.md).

## What Changes

- Add a Rust Machine daemon (`apps/machine`, crates under `crates/`) that
  serves gRPC from `.proto` files in `packages/machine-protocol/proto`:
  the frozen `stead.machine.bootstrap.v1` service and the
  `stead.machine.v1` services `MachineService`, `FileService`, `GitService`,
  `JobService`, and `McpService`.
- Add `llame-machine attach --print-socket`, which discovers the account's running
  daemon or starts it. The API connects through its Unix socket, directly or
  through SSH forwarding. **BREAKING:** `serve --stdio` is deleted; SSH forced
  commands must run `attach --print-socket`. `attach --stdio` remains a debugging relay.
- Run every command as a daemon job with output files read by byte offset. A
  job binds to its Machine, the daemon instance id, and a random job id that
  the installation draws. Jobs run on every configured Machine.
- **BREAKING:** delete `chat_job_chunks`, the 16 KiB / 1 s flush, and the
  stored output of existing jobs. Every settled job retains one bounded artifact
  copy when its daemon output remains available; definitively missing output is
  reported unavailable.
- **BREAKING:** delete `tools.bash.maxProcesses`. Each Machine sets its own
  running-job limit and output ceiling in `config.toml`.
- **BREAKING:** the daemon reads roots from `config.toml`; `roots.json` is not
  read. `instance.json` keeps its format and location.
- Switch the API's Machine connector to a generated Connect-ES client and
  delete the Node daemon, the JSON-RPC protocol, `bash-executor`, and
  `git-executor`.

## Capabilities

### New Capabilities

- `machine-daemon`: the daemon process, attach-or-start, the bootstrap
  service, protocol versioning, refusals, idempotency keys, the job store, and
  Machine-owned limits.

### Modified Capabilities

- `remote-machines`: the handshake uses the bootstrap service; the JSON-RPC
  session and the git method list are removed, and the git operations map to
  `GitService`.
- `workspace-entry`, `chat-creation`, `workspace-git-state`, `repositories`: an outdated
  daemon is one with another protocol version or an UNIMPLEMENTED git method.
- `background-jobs`: jobs bind to a Machine daemon instead of a worker, output
  lives on the Machine, and an unreachable Machine shows its jobs as unknown.
- `bash-execution`: every command is a daemon job on the current Machine, and
  background commands run on every Machine.
- `instance-config`: remove `tools.bash.maxProcesses` and apply the foreground
  promotion bound to every configured Machine while keeping `ssh://` foreground-only.
- `tool-artifacts`: retain bounded available output for settled daemon jobs
  and keep failed copies available for later daemon reconciliation.
- `tool-result-rendering`: keep the inline artifact-failure fallback separate
  from daemon-job settlement, which retains output for reconciliation.

## Impact

- New toolchain: Rust 1.98.1 through `rust-toolchain.toml` (the Nix dev shell
  provides `rustup`), `buf` and `protoc-gen-es` for TypeScript generation.
- New ADRs:
  [The Machine daemon is a Rust binary with a gRPC contract](../../../../docs/adr/2026-11-24-machine-daemon-is-rust-with-grpc-contract.md),
  [Every command is a Machine daemon job](../../../../docs/adr/2026-11-24-every-command-is-a-machine-daemon-job.md),
  [Machines own their capacity limits](../../../../docs/adr/2026-11-24-machines-own-their-capacity-limits.md).
- Related ADRs:
  [A frozen bootstrap service beside an exactly matched Machine protocol](../../../../docs/adr/2026-11-20-machine-daemon-frozen-bootstrap-service.md),
  [Host tools run through the Machine daemon](../../../../docs/adr/2026-11-20-host-tools-run-through-the-machine-daemon.md).
- Operators upgrade every configured Machine: copy the static binary, change
  the forced command, and run `llame-machine roots add` again.
