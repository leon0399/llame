---
status: accepted
---

# The host Machine daemon child gets a base environment

The API and worker processes start the host Machine daemon with only a base
environment: `PATH`, `LANG`, `TERM`, `HOME`, `TMPDIR`, `USER`, `LOGNAME`,
`LLAME_MACHINE_CONFIG_DIR`, `XDG_CONFIG_HOME`, and the `SENTRY_*` variables.
The rest of the worker environment, with its database and provider
credentials, never reaches the daemon or anything that it starts.

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
defines becomes unavailable with the unset-variable diagnostic. The operator
moves that variable into the daemon's own environment.

This was decided in the grilling session for
[feat(machines): the host as a Machine](https://github.com/leon0399/llame/issues/1831)
and is specified in the OpenSpec change
[host-as-machine](../../openspec/changes/host-as-machine/proposal.md).
