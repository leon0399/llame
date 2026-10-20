# Proposal

## Why

llame's native file tools, `bash`, Workspace entry, and Workspace MCP run only
on the API or worker host. Real project work lives on other machines: a VPS, a
homelab box, a desktop, sometimes reachable only through one or more jump
hosts. Reaching them today means `bash` running `ssh`, which is unbounded,
unattributed, and outside the `read` and `edit` permission groups. This
experimental change lets a Run use a remote **Machine** with the same tool
contracts it uses locally, while the hub keeps the Run loop, provider
credentials, Chat state, and the native effect fence.

Decision provenance: the design was settled in a grilling session recorded
against the
[multi-device placement study](../../../docs/research/product-vision/2026-10-18-multi-device-execution-placement.md);
no issue tracks it because it ships as one experimental change.

## What Changes

- New operator configuration section `machines`. Each entry names a Machine
  and its SSH destination (an alias or `user@host[:port]`); the section names
  the pinned `known_hosts` file, an optional llame identity, and the SSH
  configuration to include, so existing aliases, bastions, and credentials
  work. Without the section, no Machine surface exists.
- Hub workers connect through a generated SSH configuration whose safety
  options (pinned host keys on every hop ssh itself opens, batch mode, no agent, no connection
  sharing) override the included one, and start the operator-installed daemon
  `llame-machine serve --stdio`, speaking a versioned, multiplexed request
  protocol. The daemon refuses paths outside the roots registered on the box,
  an addressing bound rather than a security boundary.
- New locator `machine://<name>/<absolute path>` accepted by `read`, `edit`,
  `write`, the `bash` `cwd` argument, and `enter_workspace`. Bare `machine://`
  lists configured Machines with status; `machine://<name>` lists that
  Machine's registered roots. Inside a Machine Workspace, bare absolute paths
  map to that Machine's locator.
- Entering a Machine Workspace gives local-Workspace parity: relative paths,
  instruction files, Workspace skills, media, and Workspace MCP servers
  resolve on the Machine. The Machine starts stdio servers and opens HTTP
  servers itself, so `localhost` means the Machine; the MCP protocol client
  stays on the hub.
- Machines and the hub's local executor are independent: either, both, or
  neither may be configured.
- Permission rules match the canonical, decoded `machine://` text for every
  Machine operation, so local path rules never admit remote paths.
- A Machine that is unreachable keeps its Workspace binding. Only operations
  targeting that Machine fail with `machine_unavailable`; the Chat and every
  other tool keep working, and the change is narrated once each way.
- Connection status (online or offline, last seen, failure reason, versions,
  registered roots) is visible in a read-only settings list and in the Chat's
  session details sidebar, pushed live as each status changes, and the hub
  keeps reconnecting in the background.
- Operator documentation and a dated CHANGELOG entry marked experimental.

## Capabilities

### New Capabilities

- `remote-machines`: operator-configured remote Machines reached over SSH, the
  `machine://` locator across native tools and Workspace entry, Workspace
  parity on a Machine including Workspace MCP, permission matching, failure and
  offline behavior, and connection status.

### Modified Capabilities

None as deltas, by the decision to keep this experiment in one spec. The
`remote-machines` capability's last requirement states that it overrides, for
Machine locators and `machine:` executors, canonical text that is otherwise
local-only. Known canonical sentences it contradicts for Machines, to amend if
the capability graduates:

- `workspace-entry`: entry accepts only an absolute host path, and every
  attempt re-checks that the native executor identity matches the binding.
- `native-file-tools` and `bash-execution`: Workspace-relative paths resolve
  with `path.posix.resolve` and the executor receives the projected absolute
  string; tools are offered only with `tools.nativeExecutorId`.
- `bash-execution`: the model does not select an executor.
- `instruction-files`: the host chain walks from `/`.
- `tool-calling`: host-capability tools are advertised only with a local
  executor.

## Non-goals

- Dial-out connections from a Machine, tailnet or Cloudflare integration,
  relay Machines, and end-to-end encryption beyond SSH.
- Device-code enrollment, Machine-owned keys, and per-user Machine ownership:
  Machines are operator-wide and authenticated by SSH.
- Ephemeral or provisioned cloud Machines.
- Re-attaching to a call after its caller is lost, an execution-side ledger,
  capacity slots, and automatic daemon upload.
- Container Sandboxes on a Machine.

## Assumptions

- The hub reaches each Machine's first hop over SSH with the host's own `ssh`
  client; a Machine without such a route is out of scope.
- Workspace MCP configuration on a Machine follows the local trust model:
  entering the Workspace is the trust decision.
- The daemon serves one shell at a time per SSH session, so a Machine runs at
  most one shell per worker process.
- The operator installs the daemon and registers roots on the box; roots are
  editable by the Machine user, so they bound addressing only.

## Impact

- `apps/api`: instance configuration, native tool locator dispatch, `bash`
  `cwd`, Workspace entry and binding preparation, instruction-file and skill
  reads, Workspace MCP client composition, permission locator projection, a
  Machine status table and API, and an SSH session manager in workers.
- New `apps/machine` daemon; shared packages extracted from `apps/api` for
  Workspace MCP configuration, bounded stdio framing, guarded HTTP fetch, and
  bounded fetch, used by both sides. `packages/bash-executor` is reused
  unchanged; `packages/native-file-tools` gains a byte-buffer media entry point.
- `apps/web`: settings Machines list and session details Machine status,
  kept current by live `machine.upserted` messages.
- Database: a new `machines_status` table and a nullable
  `chats.workspace_told_available` column.
- Docs: a new operator page and reference updates for the `machine://`
  locator and the tools that accept it.
