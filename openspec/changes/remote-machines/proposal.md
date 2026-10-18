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
  and its SSH route (destination plus optional ordered jump hosts), and the
  section names the dedicated hub SSH identity and the pinned `known_hosts`
  file. Without the section, no Machine surface exists.
- A Machine runs a llame daemon (`llame-machine`), installed by the operator.
  Hub workers start it over SSH as `llame-machine serve --stdio` and speak a
  versioned, multiplexed request protocol over that stream. The daemon refuses
  any path outside the roots registered on the box itself.
- New locator `machine://<name>/<absolute path>` accepted by `read`, `edit`,
  `write`, the `bash` `cwd` argument, and `enter_workspace`. Bare `machine://`
  lists configured Machines with status; `machine://<name>/` lists that
  Machine's registered roots.
- Entering a Machine Workspace gives local-Workspace parity: relative paths,
  instruction files, Workspace skills, and Workspace MCP servers resolve on
  the Machine. The Machine starts stdio servers and opens HTTP servers itself,
  so `localhost` means the Machine; the MCP protocol client stays on the hub.
- Permission rules match the canonical `machine://` text for every Machine
  operation, so local path rules never admit remote paths.
- A Machine that is unreachable keeps its Workspace binding. Only operations
  targeting that Machine fail with `machine_unavailable`; the Chat and every
  other tool keep working.
- Connection status (online or offline, last seen, failing hop, daemon
  version, registered roots) is visible in a read-only settings list and in the
  Chat's Workspace indicator, and the hub keeps reconnecting in the background.
- Operator documentation and a dated CHANGELOG entry marked experimental.

## Capabilities

### New Capabilities

- `remote-machines`: operator-configured remote Machines reached over SSH, the
  `machine://` locator across native tools and Workspace entry, Workspace
  parity on a Machine including Workspace MCP, permission matching, failure and
  offline behavior, and connection status.

### Modified Capabilities

None. The `remote-machines` capability states explicitly where it extends
argument forms that `workspace-entry`, `native-file-tools`, `bash-execution`,
and `mcp-tools` otherwise restrict to the local host; their existing local
behavior is unchanged.

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
  entering the Workspace is the trust decision. Registered roots are assumed
  to be operator-validated.
- The daemon inherits `bash-executor`'s existing process limit, so one shell
  runs at a time per Machine.

## Impact

- `apps/api`: instance configuration, native tool locator dispatch, `bash`
  `cwd`, Workspace entry and binding preparation, instruction-file and skill
  reads, Workspace MCP client composition, permission locator projection, a
  Machine status table and API, and an SSH session manager in workers.
- New `apps/machine` daemon; shared packages extracted from `apps/api` for
  Workspace MCP configuration, bounded stdio framing, and bounded fetch, used
  by both sides. `packages/native-file-tools` and `packages/bash-executor` are
  reused unchanged.
- `apps/web`: settings Machines list and Workspace indicator status.
- Database: one migration for operator-wide Machine status.
- Docs: a new operator page and reference updates for the `machine://`
  locator and the tools that accept it.
