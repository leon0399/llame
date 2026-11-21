---
status: accepted
---

# Installation resources stay in the installation

The in-process executor is deleted for paths on Machines. Installation
resources keep their in-process readers: `kb://`, `skill://`, `artifact://`, `projects://`,
operator skill directories, operator MCP servers, and prompt files. They are
the same from every Machine, and no Machine daemon serves them.

We chose this because these resources belong to the installation, not to a
computer. Knowledge is owner-scoped and resolved through the Run owner. A
Knowledge read that went through the host Machine daemon would fail whenever
that daemon was down, and it would change with the current Machine. That
breaks the rule that `kb://` means the same file from every Workspace.

## Considered options

- Serve installation resources through the host Machine daemon too. We
  rejected it because it couples Knowledge to one computer and makes a
  Knowledge read fail with `machine_unavailable`.

## Consequences

The native file library stays in the API package as the backend for these
resources. A Sandbox around a Machine daemon does not confine them. Their
confinement is the installation's own access control. Every process that
serves Knowledge still mounts the Knowledge root.

This was decided in the grilling session for
[feat(machines): the host as a Machine](https://github.com/leon0399/llame/issues/1831)
and is specified in the OpenSpec change
[host-as-machine](../../openspec/changes/host-as-machine/proposal.md).
