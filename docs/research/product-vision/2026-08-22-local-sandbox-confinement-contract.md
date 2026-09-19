# Local Sandbox Confinement Contract

Recorded 2026-08-22, extracted 2026-08-24. Active, noncanonical research adjacent to the
[personal Node experiment findings](2026-08-22-personal-node-experiment-findings.md).

The findings note records what the prototype broke. This note records what it got working: a
digest-pinned, network-less, capability-stripped Docker confinement posture for executor-local
Sandbox execution, empirically verified against a real container. It is the most directly reusable
result of the experiment in pull requests #494–#512, which is closed unmerged.

This note is written to stand alone. Every argument, flag, and derivation below is reproduced here
in full, so the contract can be re-derived without fetching the archived branch.

## 1. Status

Noncanonical research. Nothing here is promoted. SPEC.md §1.1 continues to hold — no local Sandbox
executor ships — and ROADMAP keeps local Sandbox execution behind the immediate file-native cut and
behind the standalone Node and CLI. When that stage arrives, this contract is a starting point for
an OpenSpec capability spec, which is where it would become normative and testable.

Archived implementation: `apps/personal-node/src/{sandbox-container-contract,
docker-cli-container-engine,sandbox-container-lifecycle}.ts` and the `flake.nix` addition, at
`25a4fd9976cb48b9e70d90e5e8803576d49b4b1c`.

## 2. Shape: a plan, an engine, a lifecycle

Three layers, deliberately separated so the security decision is a pure function:

1. **The contract** builds an immutable `docker create` argument vector from
   `(nodeId, runId, image, workspaceSourceRealpath, user)` and a declared security posture. It calls
   nothing and touches no filesystem — it is testable without Docker installed.
2. **The engine** executes argument arrays through `execFile` (never a shell) and, crucially, reads
   the _observed_ isolation back out of `docker inspect`.
3. **The lifecycle** reconciles the observation against the plan: create when absent, start when
   stopped, refuse when a same-named container differs, remove only a verified container.

The separation is what makes the third step possible. A design that builds arguments and executes
in one place has nothing left to compare against.

## 3. The create contract

```text
create
  --name <containerName>
  --label dev.llame.node-id=<nodeId>
  --label dev.llame.run-id=<runId>
  --pull never
  --network none
  --ipc private
  --cgroupns private
  --cap-drop ALL
  --security-opt no-new-privileges=true
  --read-only
  --init
  --pids-limit 512
  --user <uid:gid>
  --tmpfs /tmp:rw,noexec,nosuid,nodev
  --mount type=bind,src=<workspaceSourceRealpath>,dst=/workspace
  --mount type=volume,src=<homeVolumeName>,dst=/home/llame
  --workdir /workspace
  <image>
```

| Flag                                    | What it denies                                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--pull never` + digest-only image      | The container's contents cannot change between review and launch; a registry cannot substitute anything.                                       |
| `--network none`                        | All egress and all lateral movement. Nothing in the Sandbox reaches the host network, the LAN, or the internet — including package installers. |
| `--ipc private`, `--cgroupns private`   | Shared-memory and cgroup-namespace visibility into the host or sibling containers.                                                             |
| `--cap-drop ALL`                        | Every Linux capability, including the ones Docker grants by default (`CHOWN`, `SETUID`, `NET_RAW`, …).                                         |
| `--security-opt no-new-privileges=true` | Privilege escalation through setuid binaries; a process cannot gain more than it started with.                                                 |
| `--read-only`                           | Writes anywhere outside the two explicit mounts and the tmpfs. The image itself is immutable at runtime.                                       |
| `--pids-limit 512`                      | Fork bombs and unbounded process growth.                                                                                                       |
| `--user <uid:gid>`, numeric non-root    | Running as root inside the container; the regex requires both ids be non-zero.                                                                 |
| `--tmpfs /tmp:rw,noexec,nosuid,nodev`   | Executing or privilege-escalating from the one writable scratch area.                                                                          |
| `--init`                                | Zombie accumulation; PID 1 reaps properly.                                                                                                     |
| `--workdir /workspace`                  | Ambiguity about where a command runs; it is fixed, not caller-selected.                                                                        |

Creating and destroying this boundary is **owner-reserved**. In the prototype's route table,
`sandbox/enter` and `sandbox/exit` — and the same pair for worktrees — require the `owner`
principal, while executing a command inside an already-created Sandbox requires only `run.execute`.
An enrolled executor works inside a confinement it cannot define, widen, or remove.

Two writable surfaces exist by design: the Workspace bind at `/workspace`, and a **per-Run named
volume** at `/home/llame` which survives container removal so caches and tool state persist across
Sandbox restarts within one Run.

### Input validation before any of it

- **Image** must match `^(?:[a-z0-9][a-z0-9._:/-]*@)?sha256:[a-f0-9]{64}$` — a registry digest or a
  bare local image ID. Mutable tags are rejected outright.
- **Workspace path** must be absolute, already canonical (`normalize(p) === p`), not `/`, and free of
  commas, NULs, CR and LF. The comma matters specifically: `--mount` is comma-delimited, so a comma
  in a path is an option-injection vector, not a cosmetic problem.
- **User** must match `^[1-9][0-9]*:[1-9][0-9]*$` — numeric, and non-zero on both sides.
- **Identities** (`nodeId`, `runId`) must match the writer-stream id pattern, so they are safe inside
  labels and resource names.
- **Resource names** are `llame-<nodeId>-<runId>` and `llame-home-<nodeId>-<runId>`, truncated to a
  `sha256`-derived suffix past 128 characters. Deterministic, so recovery can find a container by
  computing its name rather than by searching.

## 4. Command execution

```text
container exec --workdir /workspace --user <uid:gid> <containerName> <command> [args...]
```

Argument vectors only, through `execFile`. No shell is ever involved, which removes the entire
quoting and injection class rather than filtering it. The exec path is re-validated defensively at
the engine boundary — it re-checks that positions 0–5 are exactly `container exec --workdir
/workspace --user <numeric-non-root>`, that the container name is well-formed, and that the request
passes the same limits again — so a caller that assembled its own array cannot smuggle different
flags past the contract.

Bounds, with the breach behavior that matters more than the numbers:

| Bound               | Value    |
| ------------------- | -------- |
| Arguments           | ≤ 128    |
| Bytes per component | ≤ 8 KiB  |
| Bytes total         | ≤ 64 KiB |
| NUL bytes           | rejected |
| Wall clock          | 60 s     |
| Captured stdio      | 256 KiB  |

A nonzero exit is a **result**, returned as `{ exitCode, stdout, stderr }`. A _boundary_ breach —
timeout kill or stdio overflow — is not: it force-removes the container and throws, because a
process that blew its limits is a process whose state is no longer known. If teardown itself fails,
the code raises an `AggregateError` carrying both failures rather than reporting the original error
as handled.

### 4.1 Receipts at rest

Command receipts persist in executor-local SQLite, and the storage decisions are part of the posture
rather than incidental:

- **Only a `sha256` of the request is stored**, never the argv itself. A command line is among the
  most sensitive things the executor sees, and idempotency needs only to detect a mismatch, not to
  reproduce the input.
- **Stored stdout and stderr are capped at 256 KiB**, matching the live capture bound so a replayed
  receipt cannot exceed the result it replays.
- **WAL journaling, and the database files are `chmod 0o600`** after creation — owner-only, since the
  store holds execution history for one person's Node.
- **A pending receipt found at open becomes `outcome_unknown` and is never re-executed
  automatically.** Restart is not evidence that a command did not run.

## 5. Observation: the part worth copying

The engine does not trust that `create` produced what the plan asked for. It reads the container
back and compares.

```text
container ls --all --filter name=^/<escapedName>$ --format {{.Names}}
container inspect <containerName>
```

- The name filter is a regex anchored on both ends, with the name **regex-escaped** before
  interpolation; an ambiguous listing (more than the exact name) is an error, not a first-match.
- `docker inspect` output is parsed with a zod schema and treated as **untrusted input**, including a
  `.length(1)` assertion on the array.
- Observed fields: `State.Running`, `Config.{Image,User,Labels}`, `HostConfig.{NetworkMode,IpcMode,
CgroupnsMode,CapDrop,SecurityOpt,ReadonlyRootfs,PidsLimit}`, and the `Mounts` array, from which the
  writable bind at `/workspace` and the writable volume at `/home/llame` are located by destination.

The lifecycle then refuses to reuse a same-named container whose image, labels, user, mounts, or any
element of the isolation contract differs — the failure text is a contract mismatch, not a start
error. It also verifies the container disappeared after removal, and treats an unknown creation
outcome as unknown rather than assuming failure.

The generalizable rule: **a launch that returned success is not evidence of the confinement you
asked for.** Docker will happily hand back a container of the same name created by anything else,
under any policy. Only reading the running state closes that gap.

## 6. The reproducible base image

`nix build .#sandbox-image`, verbatim from the archived `flake.nix`:

```nix
sandboxTools = [
  pkgs.bashInteractive pkgs.cacert pkgs.coreutils pkgs.fd pkgs.git
  pkgs.jq pkgs.nodejs_22 pkgs.pnpm_10 pkgs.ripgrep
];
sandboxIdentity = [
  (pkgs.writeTextDir "etc/passwd" ''
    root:x:0:0::/root:${pkgs.runtimeShell}
    llame:x:1000:1000::/home/llame:${pkgs.bashInteractive}/bin/bash
  '')
  (pkgs.writeTextDir "etc/group" ''
    root:x:0:
    llame:x:1000:
  '')
];

packages.sandbox-image = pkgs.dockerTools.buildLayeredImage {
  name = "llame-sandbox";
  tag = "experiment";
  contents = sandboxTools ++ sandboxIdentity;
  fakeRootCommands = ''
    mkdir -p ./home/llame ./workspace ./tmp
    chown 1000:1000 ./home/llame ./workspace ./tmp
  '';
  config = {
    User = "1000:1000";
    WorkingDir = "/workspace";
    Env = [
      "HOME=/home/llame"
      "PATH=${pkgs.lib.makeBinPath sandboxTools}"
      "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
    ];
    Cmd = [ "${pkgs.coreutils}/bin/sleep" "infinity" ];
  };
};
```

Three details that are not obvious:

- **`/etc/passwd` and `/etc/group` are synthesized**, because a Nix-built layered image has no
  distribution base and therefore no user database. Without them, uid 1000 has no name and tools that
  resolve the current user fail.
- **The default process is `sleep infinity`.** The container is a long-lived confinement boundary that
  commands are executed _into_; PID 1 must be inert, not a shell and not an agent.
- **The toolchain is the image.** Changing the package set means changing the flake and rebuilding —
  which is the point, since `--network none` makes in-Sandbox installation impossible by construction.

Operator flow: `nix build .#sandbox-image`, `docker load --input result`, then take the immutable
`sha256:...` image **ID** from `docker image inspect` as the configured image.

## 7. What was actually verified

Empirically, not by unit test alone: `nix flake check`, a complete `nix build .#sandbox-image`, a
`docker load`, a real detached container run confirmed non-root, offline, and read-only, and the
full TypeScript path — contract → Docker adapter → lifecycle enter/status/exit — exercised against
the running daemon.

## 8. Known gaps

Stated plainly, because a confinement posture read as stronger than it is becomes a false
mitigation:

- **Local image IDs are accepted, not just registry digests.** A bare `sha256:<64hex>` is immutable
  only _on that host_; it is not a globally verifiable content address, and it cannot be checked
  against a registry. This was a deliberate widening to make the Nix-built image usable, and it
  trades verifiability for offline reproducibility.
- **No memory or CPU limits.** `--pids-limit` is the only resource ceiling; nothing bounds RAM or CPU,
  so a Sandbox can still starve its host.
- **seccomp and AppArmor are left at daemon defaults.** They are neither pinned in the plan nor
  asserted in the observation, so the actual syscall filter is whatever the host's Docker applies.
  That is not nothing, but it is unverified and undeclared — the one place where the observation
  discipline of §5 is not applied.
- **No user-namespace remapping.** Container uid 1000 is host uid 1000, so writes through the
  Workspace bind land on the host as that uid. Confinement here is capability- and
  namespace-based, not identity-based.
- **The daemon needs Docker socket access, which is host-root-equivalent.** The Sandbox confines the
  agent's commands; it does not confine the node process that launches them. Anything that
  compromises the node has the host.
- **`--network none` is absolute.** No package installs, no model calls, no MCP servers from inside
  the Sandbox. Any capability the agent needs must be in the image or proxied by the harness — a
  significant product constraint, not only a security setting.
- **Size, not distribution.** The x86_64 image is roughly 681 MB. It is a reproducibility baseline
  with no layer or closure optimization.
- **Same-daemon scope.** All of this is executor-local. Nothing here addresses a remote executor, and
  the archived authority-fencing around in-flight commands proved same-daemon behavior only.

## 9. If this is re-derived

Keep, in rough order of value: the observation discipline of §5, the pure-function separation of §2,
the argv-only exec path, and the create flag set of §3 with its validation. Revisit before adopting:
the local-image-ID allowance, the missing memory and CPU ceilings, and the undeclared seccomp
profile — each is a place where the archived prototype chose convenience, and each is cheap to close
in a specification that has not yet been written.

The flag set is the cheap part to reproduce. The discipline of reading the container back, and of
refusing a same-named container that does not match, is the part that took building it to learn.
