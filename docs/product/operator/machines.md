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
[remote-machines spec](../../../openspec/changes/remote-machines/specs/remote-machines/spec.md).

Machines and the local executor (`tools.nativeExecutorId`) are independent:
configure either, both, or neither. Machines are operator-wide: every user
whose Run passes `tools.allowed` and `tools.permissions` can address them.

## Configure

```jsonc
{
  "machines": {
    "ssh": {
      // Required. Every hop's host key, jump hosts included, must be here.
      "knownHostsFile": "/etc/llame/machine_known_hosts",
      // Optional dedicated llame key, offered before the included config's keys.
      "identityFile": "/etc/llame/machine_ed25519",
      // Optional; defaults to the worker user's ~/.ssh/config.
      "configFile": "/etc/llame/ssh_config",
    },
    "hosts": {
      "devl": { "destination": "box" },
      "gpu": { "destination": "me@gpu.lan:2222" },
    },
  },
}
```

A name matches `[a-z0-9-]{1,63}`. A destination is an alias from the included
SSH configuration or `[user@]host[:port]`; interpolation and option-shaped
values fail startup. Relative files resolve from the config file. Every API and
worker process needs an `ssh` client, the pinned file, and whatever the included
configuration references.

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

`GET /api/v1/machines` and the settings page list each Machine's state, last
seen time, last failure reason (`unreachable`, `host_key_mismatch`,
`auth_failed`, `incompatible_version`, `session_lost`), versions, and roots. A
probe runs every minute on a `runs` worker; a Machine is online when it was
reached within 150 seconds and after its last failure. A Chat bound to an
offline Machine keeps its Workspace; only operations on that Machine fail.

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
