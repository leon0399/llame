---
status: accepted
---

# The host Machine daemon child gets a base environment

The API and worker processes start the host Machine daemon with only a base
environment: `PATH`, `LANG`, `TERM`, `HOME`, `TMPDIR`, `USER`, `LOGNAME`,
`LLAME_MACHINE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE`.
The rest of the worker environment, with its database and provider
credentials, never reaches the daemon's environment or the environment of
anything that it starts.

We chose this because the daemon starts Workspace MCP servers and resolves
their interpolation against its own environment. A daemon with the full
worker environment would let any Workspace `.mcp.json` read a database URL by
name. Remote Machines already follow this rule, because no hub value reaches
them.

## Considered options

- Pass the full worker environment to the child. It keeps today's behavior,
  where a host Workspace MCP declaration can read a variable of the llame
  process. We rejected it because it gives every host Workspace MCP server a
  path to the installation's credentials.

## Consequences

A host Workspace MCP declaration that reads a variable only the worker
defines becomes unavailable with the unset-variable diagnostic. The operator sets that variable in a wrapper script and names the script in `LLAME_MACHINE_COMMAND`, so the choice of each variable is explicit.

This decision bounds the environment only. The child still runs as the worker's
OS user with that user's file access. A `{path:...}` interpolation in a host
Workspace `.mcp.json` therefore reads any file the worker user can read. A
stdio server it starts can read the worker's `/proc/<pid>/environ`. An operator
who must keep hub credentials out of host Workspaces names a wrapper in
`LLAME_MACHINE_COMMAND` that starts the daemon as a separate OS user. That user
needs access to the registered roots and to the files those Workspaces use.
Bounding `{path:...}` to the registered roots would need a separate decision.

This was decided in the grilling session for
[feat(machines): the host as a Machine](https://github.com/leon0399/llame/issues/1831)
and is specified in the OpenSpec change
[host-as-machine](../../openspec/changes/archive/2026-11-22-host-as-machine/proposal.md).
