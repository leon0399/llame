---
summary: "Configuring Machines: the host entry, SSH routes, the llame-machine daemon, registered roots, permissions, and threats"
read_when:
  - you are moving the host from tools.nativeExecutorId to machines.local
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

# Machines

**Experimental.** A Machine is a computer a Run reaches through the
`llame-machine` daemon. The host Machine is the entry named by `machines.local`,
and this process reaches it through a daemon child. Every other Machine is a
remote box reached over SSH. A Machine's files, shell, Workspace instructions,
skills, and Workspace MCP servers are addressed as
`machine://<name><absolute path>`, and the host Machine is no exception. The hub
keeps the Run loop, provider credentials, and the native effect fence; the
daemon runs on the Machine. The behavior contract is the
[remote-machines spec](../../../openspec/specs/remote-machines/spec.md).

`machines.local` is the only host identity. `tools.nativeExecutorId` no longer
exists, and a configuration that sets it fails startup. Machines are
operator-wide: every user whose Run passes `tools.allowed` and
`tools.permissions` can address them.

## Configure

The smallest configuration names the host entry and reuses the worker user's own
SSH setup for every other Machine:

```jsonc
{
  "machines": {
    // This process's own entry. Another Machine needs a destination.
    "local": "host",
    // The Machine an unbound Chat uses. Set the same value on every worker.
    "default": "host",
    "hosts": {
      "host": {}, // this computer, reached as a child
      "devl": { "destination": "box" }, // an alias from ~/.ssh/config
      "gpu": { "destination": "me@gpu.lan:2222" },
    },
  },
}
```

`local` and `default` each take a Machine name or one whole-value `{env:...}`
token, resolved once at startup. An entry without a `destination` is reachable
only where it is the `local` entry. Startup fails, naming the field, in these
cases:

- `tools.nativeExecutorId` is present. The message names `machines.local` as its
  replacement.
- `machines.local` or `machines.default` names no entry in `hosts`.
- `machines.default` is not this process's `machines.local` and has no
  `destination`.
- A native tool (`read`, `edit`, `write`, `grep`, `bash`, `enter_workspace`,
  `exit_workspace`, `stop`) is allowlisted and `machines.default` is absent.
- A regex clause on a path parameter begins with `^/`. The message names the
  group, the list, and the clause index.

A `{env:...}` token lets two workers resolve different defaults. llame cannot
detect that divergence, and each attempt's Workspace snapshot names the Machine
it used. Configure one `machines.default` on every worker.

Without `ssh`, host keys are checked against the worker user's
`~/.ssh/known_hosts` and `~/.ssh/config` is included, so existing aliases,
bastions, and keys work as they do in your terminal. The `machines.ssh` block
applies only to entries with a `destination`; the host child never uses SSH.
Checking stays strict:
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

### The host Machine

The API starts a daemon child with `shell: false`. Set `LLAME_MACHINE_COMMAND`
to override its executable and arguments. Otherwise the API uses the Rust daemon
binary for the current platform from `apps/machine/dist/<target>/llame-machine`;
`LLAME_MACHINE_BIN_DIR` overrides that distribution directory. The API discovers
the daemon socket with `attach --print-socket`, then connects to its Unix socket.
Development uses the same static binary; build it with
`pnpm --filter machine build`.

The daemon receives an allowlisted environment containing OS identity, locale,
and its configuration and state directory settings. API and Sentry credentials
are not passed to it. This is an environment boundary only: the daemon runs as
the worker's OS user with that user's file access. A `{path:...}` interpolation
in a host Workspace `.mcp.json` can therefore read any file that user can read,
including credential files and `.env.local`. See
[Workspace MCP](mcp-tools.md#interpolation-and-redaction). Use a wrapper that
starts the daemon as a separate OS user when Workspaces must not share the
worker's file access.

Exit status 78 reports `machine_identity_mismatch`. Any other discovery
failure reports `unreachable`; the next call starts a new daemon connection.
Before requesting roots or limits, the API checks protocol compatibility and
admits the daemon identity. A worker that sets `machines.local` to another
computer's name therefore fails before any operation runs on the wrong
computer.

### Another Machine

Each worker writes a private SSH configuration, opens SSH, and forwards the
remote daemon's Unix socket. The daemon is discovered remotely with
`llame-machine attach --print-socket`; configure the forced command as described
below. The generated file sets a safety block first, then includes your SSH
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

Build the static Rust daemon with `pnpm --filter machine build` and install the
target-specific `llame-machine` binary on each box. Configure it with
`config.toml`; it writes diagnostics to `daemon.log` and does not send events to
Sentry. See [observability](observability.md#machine-daemon).

Restrict the hub's key to daemon socket attachment in the box user's
`~/.ssh/authorized_keys`:

```text
restrict,command="/usr/local/bin/llame-machine attach --print-socket" ssh-ed25519 AAAA... llame-hub
```

Use the absolute path; add `from="<hub address>"` when the hub's address is
stable. To migrate a `serve --stdio` forced command, install the Rust binary
and `config.toml`, then change the command to `attach --print-socket` and allow
the hub's SSH connection to forward the daemon's Unix socket. On jump hosts,
allow forwarding only to the next hop, for example
`restrict,port-forwarding,permitopen="box:22"`. Set sshd's `ClientAliveInterval`
so a box notices a vanished hub.

The daemon implements repository inspection and worktree operations through
the typed GitService. It locates repositories only inside registered roots and
uses the located `.git` entry for status requests. Deploy the API and daemon
from the same protocol-compatible build.

One request shape is not additive: the `fs.grep` request carries its bounds in
`bounds` (with a nullable `fileBytes`), not in the removed `budget` field. The
API validates the patterns and owns the cursor and the bounds, so either build
refuses the other's request as invalid parameters. A new API reports an old
daemon as Machine unusable; an old API reports a new daemon's refusal as
`invalid_input` (the Machine refused the request as invalid). Deploy the API
and every daemon together.

Mutation results are additive in the same way, so update the hub before the
daemon. A hub newer than the daemon still accepts an old daemon's `edit` and
`write` results. An old edit keeps its post-edit `content`, `shownRange`, and
`diff`, because the owner UI numbers such a part from the `diff` header;
`lineCount` and `display` are mapped when the daemon sends them, and an edit
that carries `display` drops its `diff`. An old write keeps only `created`,
`replaced`, and `lineCount`. A hub older than the daemon refuses a status-only
write or a display-carrying edit, because it still requires the fields this
protocol revision stopped sending. Those result shapes did not change `PROTOCOL_VERSION`, so only the result
mapping differs. Protocol version 3, described under Upgrading, is the version
match the hub requires.

## Machine identity

The daemon keeps an instance id in `instance.json` in its configuration
directory. That directory is `LLAME_MACHINE_CONFIG_DIR` when it is set,
`$XDG_CONFIG_HOME/llame-machine` when that variable is set, and
`~/.config/llame-machine` otherwise.

The daemon creates the id once and reports it at every handshake. llame binds
each Machine name to the first id it sees. A daemon that answers with another
id is refused with `machine_identity_mismatch`, and the Machine reads offline
until an operator acts.

After a legitimate reinstall, run `pnpm --filter api machines:forget <name>` on
the hub. The next handshake binds the new id. Copying the configuration
directory also copies the id, so the binding catches misconfiguration rather
than impersonation.

The local child and any SSH login for one Machine must use one configuration
directory. A second directory creates a second instance id, and the second path
to answer for the name gets `machine_identity_mismatch`. Set
`LLAME_MACHINE_CONFIG_DIR` identically for both paths.

## Upgrading

Protocol version 3 carries the instance id, the build id, the static facts
of the Machine, and the unit-letter and line-and-column read selectors. Upgrade every Machine daemon before the API. Run
`llame-machine --version` on each box to read the release, the build, the
protocol version, and the instance id. A box that runs an older daemon shows as
offline with "update required" until you replace the binary.

The Machines list and the `machine://` listing show each Machine's OS and
architecture once a handshake reports them.

This release removes `tools.nativeExecutorId` and moves the host into
`machines.hosts`. Deploy the configuration change and the database migration
together, and take a backup first: a rollback from this release restores that
backup.

1. Add a `machines.hosts` entry named after the old `tools.nativeExecutorId`
   value. Bound host Chats keep their executor, because the stored value stays
   the same.
2. Set `machines.local` and `machines.default`. Set one value on every worker.
3. Remove `tools.nativeExecutorId`. Startup fails while it remains.
4. Rewrite every `^/` path allow to `^machine://[^/]+/`. A `^/` regex fails
   startup and names the clause. Reject clauses in any spelling keep working,
   because a reject also sees the projected path.
5. Register the host's roots with `llame-machine roots add`, as described
   under Register roots.

An existing host Chat detaches with `executor_absent` when the configuration has
no entry named after its stored executor. A Chat that names a Machine the
configuration no longer declares detaches the same way.

An old `tools.nativeExecutorId` outside the Machine name grammar
(`[a-z0-9-]{1,63}`), such as `personal_host`, stops the migration with a named
error, and nothing changes. Rename it in the database before the upgrade, then
name the host entry after the new value:

```sql
BEGIN;
UPDATE chats SET workspace_executor_id = 'personal-host-a' WHERE workspace_executor_id = 'personal_host';
UPDATE checkouts SET executor_id = 'personal-host-a' WHERE executor_id = 'personal_host';
UPDATE project_repository_defaults SET executor_id = 'personal-host-a' WHERE executor_id = 'personal_host';
UPDATE projects SET default_executor_id = 'personal-host-a' WHERE default_executor_id = 'personal_host';
COMMIT;
```

The migration converts every stored `machine:<name>` executor to `<name>` and
every stored bare root to a `machine://` locator. It rewrites one transaction
and fails on an unknown executor value, so a failed run changes nothing.

This release uses the host daemon child for every host path a Run touches. Host
file tools, `grep`, every git and worktree call, host Workspace entry, host
Workspace MCP servers, host instruction files, Workspace skills, and prompt
imports all run through that child under its registered roots. Host `bash` and
its background jobs remain the only host operations that run in the worker.

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

The host Machine needs roots too, registered on the host as the llame process
user. A host Chat served by another worker over SSH is already root-bounded, so
register the directories you work in before the upgrade. In development,
`pnpm dev` sets `LLAME_MACHINE_COMMAND` and `LLAME_MACHINE_CONFIG_DIR` and runs
`apps/api/scripts/dev-machine-host.mts`, which registers the repository's
parent directory and the operating system's temporary directory. Those cover the
default `.llame-worktrees` directory beside the clone.

Host Workspace context is bounded by the same roots. A Workspace must lie
inside a root to be entered. A host instruction file or Workspace skill source
outside every root contributes nothing, and a host prompt import outside every
root stays prose. Register every directory that holds a Workspace, an
instruction file, or a skill package a host Run must see.

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
`enter_workspace` spellings. An allow is decided on that locator, so a rule
names the Machine it admits:

```jsonc
{
  "tools": {
    "permissions": {
      "read": {
        "allow": true,
        "reject": [
          { "field": "path", "regex": "^machine://[^/]+/opt/secret(/|$)" },
          { "field": "path", "regex": "^machine://[^/]+/home/me/\\.ssh(/|$)" },
        ],
      },
    },
  },
}
```

A path regex that begins with `^/` fails startup and names the group, the list,
and the clause index. Rewrite it once in canonical form. A literal clause
stays a substring match, so `"/opt/secret"` matches
`machine://devl/opt/secret/key` too. A reject also sees the projected path
without the scheme and Machine name, so an older reject spelling keeps
refusing every Machine.

The recommended portable policy allows `read`, `edit`, `write`, and `bash` for
every path, so configuring Machines with it exposes every registered root to
every eligible user. To scope access, allow per Machine:

```jsonc
{
  "tools": {
    "permissions": {
      "read": {
        "allow": [
          { "field": "path", "regex": "^machine://devl/home/me/work/" },
        ],
        "reject": [
          { "field": "path", "regex": "^machine://[a-z0-9-]+/.*/\\.ssh(/|$)" },
        ],
      },
    },
  },
}
```

## Status

`GET /api/v1/machines`, the settings page, and a Chat's session details
sidebar list each Machine's state, last seen time, last failure reason
(`unreachable`, `host_key_mismatch`, `auth_failed`, `incompatible_version`,
`session_lost`, `identity_mismatch`), versions, the OS and architecture the
daemon reported, and roots. A probe runs every minute on a `runs` worker. A
process probes and records status only for an entry it can reach: its
`machines.local` entry or an entry with a destination. A worker therefore
records nothing for a host entry of another computer. A
Machine is online when it was reached within 150 seconds and after its last
failure. A Chat bound to an offline Machine keeps its Workspace, and only
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
  as the Machine user without a sandbox, the host Machine included.
- **The host Machine is the worker's computer.** `machines.local` names it, and
  a wrong name fails the identity handshake instead of running the operation.
  It shares that computer with the worker process, so give its entry the roots
  and permissions the worker user should reach.
- **Shared boxes run repository commands.** Entering a Machine Workspace is the
  trust decision for its `.mcp.json`: any user allowed to enter it starts that
  repository's servers as the Machine user.
- **No isolation between users on a box.** All users act as one OS user and can
  read or change each other's files, instructions, and MCP configuration on
  that box. Hub-held state (bindings, Workspace MCP clients, results) stays
  owner-scoped.
- **Hub key compromise.** The forced command limits a dedicated key to starting
  the daemon; identities from your included configuration keep whatever
  authority you gave them.
- **Secrets.** `.mcp.json` interpolation runs on the box with the box's
  environment; the hub never sends commands, URLs, or headers. The host box's
  daemon gets only the base environment, so a Workspace declaration cannot read
  a worker-only variable by name. The daemon still runs as the worker's OS user:
  a `{path:...}` location reaches every file that user can read, and the daemon
  can read process environment data accessible to that user. Run the host daemon
  as a separate OS user when hub credentials must stay out of host Workspaces.
  Values the box resolves come back only for redaction.
