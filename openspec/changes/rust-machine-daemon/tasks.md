Feature issue: to be created. One-shot experimental implementation; review
rounds are skipped by Leo's decision, and Leo reviews the ADRs.

# Tasks

## 0. Delivery graph

```text
master <- rust-machine-daemon/proposal <- rust-machine-daemon/skeleton
       <- rust-machine-daemon/files <- rust-machine-daemon/jobs
       <- rust-machine-daemon/git <- rust-machine-daemon/mcp
       <- rust-machine-daemon/connector <- rust-machine-daemon/host-jobs
       <- rust-machine-daemon/engine-cleanup <- rust-machine-daemon/finalize
```

| Section | Branch                               | Parent         | Owns                                                                                                  |
| ------- | ------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------- |
| 1       | `rust-machine-daemon/proposal`       | `master`       | this change and the ADRs                                                                              |
| 2       | `rust-machine-daemon/skeleton`       | proposal       | Cargo workspace, proto, generated code, `machine-core`, attach-or-start, bootstrap and roots services |
| 3       | `rust-machine-daemon/files`          | skeleton       | `machine-files` and `machine-grep`                                                                    |
| 4       | `rust-machine-daemon/jobs`           | files          | `machine-jobs`                                                                                        |
| 5       | `rust-machine-daemon/git`            | jobs           | `machine-git`                                                                                         |
| 6       | `rust-machine-daemon/mcp`            | git            | `machine-mcp`                                                                                         |
| 7       | `rust-machine-daemon/connector`      | mcp            | the Connect-ES connector, deletion of the Node daemon and JSON-RPC                                    |
| 8       | `rust-machine-daemon/host-jobs`      | connector      | host `bash` and jobs through the daemon, the job migration                                            |
| 9       | `rust-machine-daemon/engine-cleanup` | host-jobs      | deletion of `bash-executor`, `git-executor`, and dead engine code                                     |
| 10      | `rust-machine-daemon/finalize`       | engine-cleanup | spec sync and archive                                                                                 |

- Safe merge boundaries: after each section. Sections 2 to 6 ship a daemon
  that the Cargo tests call; the API keeps the Node daemon until section 7.
- Each layer checks its own tasks in this file; the proposal layer checks only
  section 1.
- Generated churn (`packages/machine-protocol/src/generated`, `Cargo.lock`,
  `pnpm-lock.yaml`, Drizzle snapshots) counts zero.

## 1. Proposal (`rust-machine-daemon/proposal`)

- [x] 1.1 Commit the proposal, design, delta specs, tasks, and ADRs; verify
      with `pnpm exec openspec validate rust-machine-daemon --strict`.

## 2. Skeleton (`rust-machine-daemon/skeleton`)

- [x] 2.1 Add the Cargo workspace, `rust-toolchain.toml`, lints, and `rustup`
      in the Nix dev shell.
- [x] 2.2 Add the proto files, `buf` lint and generation, the generated
      TypeScript, and the `machine-protocol` crate.
- [x] 2.3 Add `machine-core`: configuration, instance id, root guard,
      refusals, idempotency cache, facts.
- [x] 2.4 Add the daemon, `attach --print-socket`, the bootstrap and roots services;
      verify `cargo test -p llame-machine --test bootstrap`.
- [x] 2.5 Remove the experimental Connect-ES-over-stdio smoke when socket
      transport replaces it; keep generated protocol checks and Cargo bootstrap tests.

## 3. Files (`rust-machine-daemon/files`)

- [x] 3.1 Implement `FileService.GetEntry`, `ListDirectory`, `ReadLines`, and
      `ReadBytes`; verify `cargo test -p llame-machine --test files`.
- [x] 3.2 Implement `FileService.WriteFile` and `ReplaceText` with idempotency
      keys; verify `cargo test -p llame-machine --test files`.
- [x] 3.3 Implement `FileService.SearchFiles`; verify
      `cargo test -p llame-machine --test search`.

## 4. Jobs (`rust-machine-daemon/jobs`)

- [ ] 4.1 Implement `JobService` with per-job directories, the snapshot stream,
      limits, stop proof, and restart settlement; verify
      `cargo test -p llame-machine --test jobs`.

## 5. Git (`rust-machine-daemon/git`)

- [ ] 5.1 Implement `GitService`; verify `cargo test -p llame-machine --test git`.
- [ ] 5.2 Check the git directory, common directory, and object alternates
      against the roots before any git process starts; verify a test whose
      common directory lies outside every root and that observes no git start.
- [ ] 5.3 Add `GitService.LocateRepository`, which starts no git process and
      reports a path that is not a directory, and make `GetStatus` take the
      admitted git entry and refuse a changed one; refuse every option-like
      caller value, including `base`; verify each with a Cargo test.

## 6. MCP (`rust-machine-daemon/mcp`)

- [ ] 6.1 Implement `McpService.ListServers` and the `OpenSession` stream; verify
      `cargo test -p llame-machine --test mcp`.

## 7. Connector (`rust-machine-daemon/connector`)

- [ ] 7.1 Replace the JSON-RPC session with the Connect-ES connector and the
      locator adapter; verify the API machine unit tests and typecheck.
- [ ] 7.2 Delete the Node daemon and the JSON-RPC protocol; run `pnpm dev`,
      Playwright, and the integration suite against the Rust binary.
- [ ] 7.3 Verify the persistent TypeScript client tests over the real socket
      and SSH forward for bootstrap, unary, server-streaming, and bidirectional calls.
- [ ] 7.4 Report `attach` exit status 78 as `machine_identity_mismatch` and map
      the `GitService` failures to the installation's git results; verify
      connector tests for both.
- [ ] 7.5 Update the Machine, observability, and repositories operator docs
      for `attach --print-socket` discovery, socket forwarding, and the
      forced-command migration.

## 8. Host jobs (`rust-machine-daemon/host-jobs`)

- [ ] 8.1 Run host `bash` and every job through the daemon, bind jobs to the
      Machine, reconcile from `JobService.WatchJobs` and `ListJobs`, and drop
      `chat_job_chunks`, `worker_instance_id`, and `tools.bash.maxProcesses`.
- [ ] 8.2 Update the job operator docs, SPEC.md §23.1, and the CHANGELOG
      entries for the job breaking changes.

## 9. Engine cleanup (`rust-machine-daemon/engine-cleanup`)

- [ ] 9.1 Delete `bash-executor`, `git-executor`, and native-file-tools I/O
      code that only the Node daemon used; verify workspace typecheck.

## 10. Finalize (`rust-machine-daemon/finalize`)

- [ ] 10.1 Sync the delta specs and archive the change.
