---
summary: "Enabling experimental ssh:// reads: the ssh section, pinned host keys, the included SSH configuration, permission rules on the resolved locator, and the threats"
read_when:
  - you are enabling ssh:// locators for reads on external hosts
  - you are deciding which ssh:// destinations a permission policy admits
  - you need to diagnose a refused ssh:// read
behavior:
  - ../reference/locators/ssh.md
  - ../reference/tools/read.md
  - ../reference/locators/index.md
---

# SSH locators

**Experimental.** An `ssh://` locator reads a file or one directory level on a
host the operator's own SSH configuration reaches. Nothing is installed on that
host: the hub runs the system `ssh` client, sends a POSIX `sh` script on stdin,
and reads the framed answer back. The behavior contract is the
[ssh-locator spec](../../../openspec/changes/ssh-locator/specs/ssh-locator/spec.md);
what a result contains is in the
[ssh locator reference](../reference/locators/ssh.md).

SSH locators and the local executor (`tools.nativeExecutorId`) are independent:
configure either, both, or neither. They are operator-wide: every user whose Run
passes `tools.allowed` and `tools.permissions` can address them, with the SSH
identity of the instance.

## Enabling

The top-level `ssh` section turns the locator on. Without it, `ssh://` is an
unknown scheme: `read` returns `invalid_path` and no SSH process starts. The
smallest configuration reuses the worker user's own SSH setup:

```jsonc
{
  "ssh": {},
}
```

Each field overrides one file:

```jsonc
{
  "ssh": {
    // Default ~/.ssh/known_hosts. Every hop's host key must be in this file.
    "knownHostsFile": "/etc/llame/ssh_known_hosts",
    // Optional dedicated llame key, offered for the connections llame makes.
    "identityFile": "/etc/llame/ssh_ed25519",
    // Default ~/.ssh/config. Its aliases, jump hosts, and users apply.
    "configFile": "/etc/llame/ssh_config",
    // Optional agent: "SSH_AUTH_SOCK" or a socket path. Default: no agent.
    "identityAgent": "SSH_AUTH_SOCK",
  },
}
```

Interpolation is not applied to these values, and an unknown key or a wrong
type fails startup naming the field. Relative paths resolve from the
configuration file, and `~/` from the llame process user's home. Every API and
worker process that executes Runs needs an `ssh` client, the pinned file, and
whatever the included configuration references; keep `read` in `tools.allowed`
for the users who may use it.

This section is separate from `machines.ssh`: configuring one does not enable
the other, so an instance can reach external hosts without declaring a Machine.

Enabling the section also makes an `@ssh://…` marker in a prompt an import
target. Each marker is read once through `read`, with the read's own admission,
and a target the rules deny or the read fails is reported as not imported (see
[prompt imports](../reference/prompt-imports.md#targets)).

### Using an SSH agent

By default llame uses no SSH agent, so a key that lives only in an agent does
not authenticate and the call fails with `ssh_unavailable` reason
`auth_failed`. Set `identityAgent` to `SSH_AUTH_SOCK` to use the agent named by
that variable in the llame process environment, or to an absolute socket path.
The agent is never forwarded to the remote host, and Machines never use it.

Every key in that agent then authenticates to every destination a Run can
reach, and the model chooses the destination. Bound the reach with a dedicated
`knownHostsFile` that lists only the hosts llame may contact, and with
host-scoped allows (see [Permissions](#permissions-on-the-resolved-locator)).
`SSH_AUTH_SOCK` must also stay valid for the life of the worker process: an
agent tied to a login session stops working when that session ends.

## Pinned host keys

Every hop opens its own connection — the destination, and each jump host along
the way — and every key must already be in `knownHostsFile`. Checking is strict
and batch mode is on, so nothing is learned or confirmed on first use: an
unknown host fails as `ssh_unavailable` with reason `host_key_mismatch`, and no
remote command runs. Populate the file by connecting once by hand, or with
`ssh-keyscan` after verifying the fingerprints out of band.

The generated configuration wins over the included one for every hop, because
`ssh` keeps the first value it obtains:

```text
Host *
  UserKnownHostsFile <knownHostsFile>
  GlobalKnownHostsFile none
  StrictHostKeyChecking yes
  BatchMode yes
  IdentityAgent none            # or the configured identityAgent
  ForwardAgent no
  ForwardX11 no
  ControlMaster no
  ControlPath none
  PermitLocalCommand no
  UpdateHostKeys no
  ConnectTimeout 10
  ServerAliveInterval 15
  ServerAliveCountMax 3
  IdentityFile <identityFile>   # only when identityFile is configured
Include <configFile>
```

An included `StrictHostKeyChecking accept-new` or a `ControlMaster auto` cannot
weaken that block.

## Included configuration

Aliases, `HostName`, `User`, `Port`, `ProxyJump`, identities, and `IdentityFile`
come from `configFile`. Five things there are not neutralized, and each is the
operator's responsibility:

- **`Match exec`.** Resolving a destination runs the local SSH configuration
  evaluation (`ssh -F <generated> -G`), and OpenSSH runs `Match exec` conditions
  while evaluating. A locator that passes the submitted-text rejects therefore
  runs those commands, with the destination's `%h`/`%r` expanded, even when the
  resolved text is then rejected. Keep `Match exec` out of the hosts llame
  uses, or make it side-effect free.
- **`CanonicalizeHostname`.** With canonicalization enabled, evaluation may do
  a DNS lookup for the destination. Resolution is bounded to 5 seconds and a
  failure is `ssh_unavailable` with reason `config`, but the lookup itself
  leaves the worker.
- **`ProxyCommand`.** A proxy command runs as written on the worker host, and
  the connection it opens is outside the safety block. Prefer `ProxyJump`.
- **`SendEnv`.** The included entries still forward those variables to the
  remote session. Keep the host from forwarding anything it should not see.
- **`Match host`.** The connection sets `HostName` on the command line and the
  resolution does not, so a `Match host` block can apply in one step and not
  the other, and a block placed after a `HostName` line may never see the alias.
  The address stays the one the permission rules checked, but the `ProxyJump` or
  identity can differ. Scope jump hosts and identities with `Host`.

## Permissions on the resolved locator

A destination resolves before the group decides, so an alias cannot hide the
address it reaches. Rules match `ssh://<user>@<hostname>:<port><absolute path>`
with the resolved user, the resolved hostname in lowercase, the resolved port
(defaults included), and the path decoded once with `.`, `..`, and a trailing
separator kept.

Rejects run twice: on the submitted text with the selector removed, before
anything resolves, and then on the resolved locator. A match in either refuses
the call. The allow is decided once, on the resolved text, and the connection
uses exactly that user, hostname, and port. A rule anchored at `^/` never
admits an ssh locator.

Allow per host and repeat the local rejects in ssh form:

```jsonc
{
  "tools": {
    "permissions": {
      "read": [
        {
          "decision": "allow",
          "path": "^ssh://deploy@edge-1\\.lan:22/var/log/",
        },
        {
          "decision": "reject",
          "path": "^ssh://[^/]*@edge-1\\.lan:22/.*(^|/)\\.\\.(/|$)",
        },
        {
          "decision": "reject",
          "path": "^ssh://[^/]*@edge-1\\.lan:22/.*(^|/)\\.ssh(/|$)",
        },
      ],
    },
  },
}
```

`..` stays in the resolved text, exactly as for local and Machine paths, so
`/var/log/../../etc/shadow` matches a `/var/log/` allow. The second rule is the
anchored reject that closes it for the hosts where it matters; the third keeps
`~/.ssh` out of a broad allow. A whole-tool `read: allow: true` admits every
pinned host the instance's identity can reach.

## Failure reasons

A refused connection is `ssh_unavailable` with one reason: `host_key_mismatch`,
`auth_failed`, `unreachable`, `config`, `client_missing` (no `ssh` client on the
worker), or `session_lost` (the read started and stopped before its end
trailer). A host that cannot run the script is `ssh_unsupported_host`: it has no
POSIX `sh`, or its account ran a forced command or `nologin` instead. No probe
runs: each failure is classified from the operation itself, so the first read of
a misconfigured host is also the diagnosis.

## Threats

- **T1. Model-chosen destinations.** The model chooses among the destinations
  the permission groups admit, and the instance's identity decides what it can
  authenticate to. A broad allow reaches every pinned host that identity can
  log in to; scope allows per host.
- **T2. Injection.** Host, user, and port are restricted to a strict character
  set before any process starts, the destination is passed after `--`, and the
  remote script and its arguments travel on stdin, single-quoted. Model text
  never reaches an `ssh` option or the remote argv.
- **T3. Operator configuration side effects.** Resolution runs the included
  `Match exec` commands and may resolve DNS for every locator that passes the
  submitted-text rejects, including ones the resolved text then rejects. Only
  users who pass the `read` group can trigger it.
- **T4. Remote work that outlives the hub.** A remote process can keep running
  after the local `ssh` is killed. A read transfers one bounded file or listing
  and then exits, so it leaves nothing behind; remote commands are not part of
  this revision.
- **T5. No isolation between users.** Every user acts with one SSH identity on
  each host and can read whatever that login user can. Hub-held state — attempts,
  results, and events — stays owner-scoped per user.
- **T6. Included configuration.** Identities, `ProxyCommand`, `Match exec`, and
  `SendEnv` in the included file apply as written; the safety block bounds host
  key checking, not what the operator configured.

## Not in this revision

`edit` and `write` refuse an `ssh://` locator with `unsupported_operation`,
`enter_workspace` refuses it, and a remote `bash` working directory is not
accepted. Host listing, remote line selectors inside the script, SFTP and
Windows hosts, connection reuse, and a proven remote stop are follow-ups.
