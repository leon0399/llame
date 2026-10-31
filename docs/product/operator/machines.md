---
summary: "Configuring experimental remote Machines: SSH routes, the llame-machine daemon, registered roots, permissions, and threats"
read_when:
  - you are adding a remote Machine that Runs reach over SSH
  - you are deciding which Machine paths a permission policy admits
  - you need to diagnose a Machine reported offline
behavior:
  - ../reference/locators/machine.md
  - ../reference/tools/read.md
  - ../reference/tools/edit.md
  - ../reference/tools/write.md
  - ../reference/tools/bash.md
  - ../reference/tools/enter-workspace.md
  - ../reference/tools/exit-workspace.md
  - ../reference/instruction-files.md
---

# Remote Machines

**Experimental.** A Machine is a remote box a Run reaches over SSH. Its files,
shell, Workspace instructions, skills, and Workspace MCP servers behave as on
the local executor, addressed as `machine://<name><absolute path>`. The hub
keeps the Run loop, provider credentials, and the native effect fence; the box
runs the `llame-machine` daemon, which hub workers start over SSH for each
session. The behavior contract is the
[remote-machines spec](../../../openspec/specs/remote-machines/spec.md).

Machines and the local executor (`tools.nativeExecutorId`) are independent:
configure either, both, or neither. Machines are operator-wide: every user
whose Run passes `tools.allowed` and `tools.permissions` can address them.

## Configure

The smallest configuration reuses the worker user's own SSH setup:

```jsonc
{
  "machines": {
    "hosts": {
      "devl": { "destination": "box" }, // an alias from ~/.ssh/config
      "gpu": { "destination": "me@gpu.lan:2222" },
    },
  },
}
```

Without `ssh`, host keys are checked against the worker user's
`~/.ssh/known_hosts` and `~/.ssh/config` is included, so existing aliases,
bastions, and keys work as they do in your terminal. Checking stays strict:
every hop, jump hosts included, must already be in that file (connect once by
hand, or `ssh-keyscan` and verify), and nothing is learned on first use.
Override any of the three files:

```jsonc
{
  "machines": {
    "ssh": {
      // Default ~/.ssh/known_hosts. Every hop's host key must be here.
      "knownHostsFile": "/etc/llame/machine_known_hosts",
      // Optional dedicated llame key, offered before the included config's keys.
      "identityFile": "/etc/llame/machine_ed25519",
      // Default ~/.ssh/config.
      "configFile": "/etc/llame/ssh_config",
    },
    "hosts": { "devl": { "destination": "box" } },
  },
}
```

A name matches `[a-z0-9-]{1,63}`. A destination is an alias from the included
SSH configuration or `[user@]host[:port]`; interpolation and option-shaped
values fail startup. Relative files resolve from the config file, and `~/` from
the llame process user's home. Every API and worker process needs an `ssh`
client, the pinned file, and whatever the included configuration references.

## How the hub connects

Each worker writes a private SSH configuration and runs
`ssh -F <generated> -T -- <destination> llame-machine serve --stdio`. The
generated file sets a safety block first and then includes your SSH
configuration, so your aliases, `ProxyJump` chains, users, ports, and
identities apply while these options win for every hop:

```text
Host *
  UserKnownHostsFile <knownHostsFile>
  GlobalKnownHostsFile none
  StrictHostKeyChecking yes
  BatchMode yes
  IdentityAgent none
  ForwardAgent no
  ForwardX11 no
  ControlMaster no
  ControlPath none
  PermitLocalCommand no
  UpdateHostKeys no
  ConnectTimeout 10
  ServerAliveInterval 15
  ServerAliveCountMax 3
Include <configFile>
```

Two options cannot be neutralized from the block: `SendEnv` entries in your
configuration still forward those variables, and a `ProxyCommand` in your
configuration runs as written on the worker host. Keep both out of the hosts
llame uses.

## Install the daemon

Build `pnpm --filter machine build` and copy `apps/machine/dist/llame-machine.cjs`
to the box (for example `/usr/local/bin/llame-machine`, executable, Node 22.19 or
newer on the box). Restrict the hub's key to the daemon in the box user's
`~/.ssh/authorized_keys`:

```text
restrict,command="/usr/local/bin/llame-machine serve --stdio" ssh-ed25519 AAAA... llame-hub
```

Use the absolute path; add `from="<hub address>"` when the hub's address is
stable. On jump hosts, allow forwarding only to the next hop, for example
`restrict,port-forwarding,permitopen="box:22"`. Set sshd's
`ClientAliveInterval` so a box notices a vanished hub.

To report the daemon's errors and traces to Sentry, set its variables in the
same forced command; see [observability](observability.md#machine-daemon).

The daemon also answers the typed git methods (`git.inspect`, `git.status`,
`git.worktreeAdd`, `git.worktreeList`, `git.worktreeRemove`) that checkout
registration and worktree entry use. They are additive to the protocol: the
version did not change, and the handshake lists every method a daemon answers.
After updating the hub, replace the daemon binary on each box with the same
build. A box whose handshake listed no git methods keeps serving files and
`bash`, and a git call on it fails as `machine_update_required` until the
binary is replaced.

Mutation results are additive in the same way, so update the hub before the
daemon. A hub newer than the daemon still accepts an old daemon's `edit` and
`write` results: the daemon's post-edit `content` and `shownRange` are
forwarded, its `diff` is dropped, and `lineCount` and `display` are mapped when
it sends them. A hub older than the daemon refuses a status-only write or a
display-carrying edit, because it still requires the fields this protocol
revision stopped sending. No `PROTOCOL_VERSION` bumped, so the handshake stays
compatible in both directions; only the result mapping differs.

## Register roots

On the box, as the daemon's user:

```bash
llame-machine roots add ~/work/shop
llame-machine roots list
llame-machine roots remove ~/work/shop
```

Roots live in `$XDG_CONFIG_HOME/llame-machine/roots.json`. The daemon refuses
every path outside them with `path_not_registered`. Roots bound addressing
only: anything running as that user, including Machine `bash` and Workspace MCP
servers, can edit the roots file. The hub has no operation that changes roots.

A git worktree on a Machine must lie inside a registered root, because the
daemon decides the worktree directory before any git call. By default a new
worktree sits in a sibling `.llame-worktrees` directory of the source clone, so
register the source clone's parent directory, not only the clone itself;
`llame-machine roots add ~/work` covers both. If you would rather keep the
worktrees elsewhere, register that directory too and set `worktree_base` on the
main checkout inside a root — for example
`machine://devl/home/me/work/trees`. A directory no root contains answers
`path_not_registered` and starts no git command. A git result path outside
every root — a repository whose toplevel sits above them, as a tracked home
directory does, or a worktree kept elsewhere — is refused the same way rather
than reported as a locator.

## Permissions

Permission groups match the canonical, decoded Machine locator, for example
`machine://devl/home/me/work/shop/src/app.ts`, including `bash` `cwd` and both
`enter_workspace` spellings. A rule anchored at `^/` never admits a Machine
path. The recommended portable policy allows `read`, `edit`, `write`, and
`bash` for every path, so configuring Machines with it exposes every registered
root to every eligible user. To scope access, allow per Machine and repeat the
local rejects in Machine form:

```jsonc
{
  "tools": {
    "permissions": {
      "read": [
        { "decision": "allow", "path": "^machine://devl/home/me/work/" },
        {
          "decision": "reject",
          "path": "^machine://[a-z0-9-]+/.*/\\.ssh(/|$)",
        },
      ],
    },
  },
}
```

## Status

`GET /api/v1/machines`, the settings page, and a chat's session details
sidebar list each Machine's state, last seen time, last failure reason
(`unreachable`, `host_key_mismatch`, `auth_failed`, `incompatible_version`,
`session_lost`), versions, and roots. A probe runs every minute on a `runs`
worker; a Machine is online when it was reached within 150 seconds and after
its last failure. A Chat bound to an offline Machine keeps its Workspace; only
operations on that Machine fail.

Status changes are pushed to signed-in clients over the live WebSocket as
`machine.upserted`, and a Machine removed from the configuration is pruned on
the next probe and pushed as `machine.deleted`, so open views update without
polling. Online is derived from elapsed time, not stored: a client shows the
last status it received. While the probe runs, that is the
current state within a minute. If nothing writes status at all — every `runs`
worker is down, or the probe job is disabled — no message is sent, so a
connected client keeps the last value it saw until it reconnects or receives
`resync`, which refetches the list. Treat a stale "online" in a long-idle tab
as expected rather than as evidence the Machine is reachable.

## Threats

- **Model-addressed remote execution.** The model chooses among the
  `machine://` addresses your permission groups admit. Machine operations run
  as the box user without a sandbox.
- **Shared boxes run repository commands.** Entering a Machine Workspace is the
  trust decision for its `.mcp.json`, as on the local executor: any user allowed
  to enter it starts that repository's servers as the box user.
- **No isolation between users on a box.** All users act as one OS user and can
  read or change each other's files, instructions, and MCP configuration on
  that box. Hub-held state (bindings, Workspace MCP clients, results) stays
  owner-scoped.
- **Hub key compromise.** The forced command limits a dedicated key to starting
  the daemon; identities from your included configuration keep whatever
  authority you gave them.
- **Secrets.** `.mcp.json` interpolation runs on the box with the box's
  environment; the hub never sends commands, URLs, or headers. Values the box
  resolves come back only for redaction.
