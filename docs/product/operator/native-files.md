---
summary: "Enabling and restricting the host-backed native file tools, bash, Workspace entry, and permission modes"
read_when:
  - you are enabling or changing native file access, bash, or Workspace entry
  - you are deciding the Workspace entry or permission-mode policy of an instance
behavior:
  - ../reference/tools/read.md
  - ../reference/tools/edit.md
  - ../reference/tools/write.md
  - ../reference/tools/bash.md
  - ../reference/tools/enter-workspace.md
  - ../reference/tools/exit-workspace.md
  - ../reference/locators/index.md
  - ../reference/selectors.md
  - ../reference/instruction-files.md
  - ../reference/permission-modes.md
  - ../reference/mutation-recovery.md
---

# Native file tools

`read`, `edit`, and `write` select their authority from the scheme of their
`path` argument: an absolute path or a `file://` alias runs on the worker's
filesystem with its OS user's authority, and `kb://` resolves through the
trusted Run owner's current Knowledge Space access without binding the Run to an
executor. `bash` shares the absolute-path host gate.

This page covers enabling and policy only. What each tool does is documented in
[read](../reference/tools/read.md),
[edit](../reference/tools/edit.md),
[write](../reference/tools/write.md), and
[bash](../reference/tools/bash.md); the authority each locator scheme reaches
is summarized in [locators](../reference/locators/index.md), and line and
representation selectors in [selectors](../reference/selectors.md).

## Enabling

Absolute-path access and `bash` need a trusted host identity in the instance
configuration named in the [operator index](index.md#operator), then a restart
of the API and worker:

```json
{
  "tools": {
    "nativeExecutorId": "personal-host-a",
    "allowed": ["read", "edit", "write", "bash"]
  }
}
```

`kb://` locators need only a configured `knowledge.root`; `tools.allowed`
still gates each tool id. A process with `knowledge.root` and no
`nativeExecutorId` advertises `read`, `edit`, and `write`, all usable with a
locator — an absolute path argument on that process fails closed with
`executor_unavailable` instead of resolving through the Knowledge root.

Optional trusted bash cwd (defaults to the cwd of the process that executes the
Run, so a split web/worker deployment resolves it in the worker, and a bound
Workspace root overrides it):

```bash
BASH_WORKING_DIRECTORY=/absolute/project
```

Keep any other desired tool ids in `allowed`. Each distinct host filesystem
needs a distinct, stable `nativeExecutorId`. Co-located API and worker processes
that use the same native filesystem should use the same identity. Without it,
absolute-path native access and `bash` are unavailable even when allowlisted.

## Permission modes

`tools.permissionModes` is an ordered list of per-Run modes. It defaults to
`["default"]` and must always include `default`, so a fresh install does not
offer `bypass`. Add `bypass` to make it selectable:

```json
{
  "tools": {
    "permissionModes": ["default", "bypass"]
  }
}
```

The setting is instance-wide: enabling `bypass` enables it for every
authenticated user, with no per-user gate. Restart the API and every worker
after changing it so the enabled list is consistent.

Treat `bypass` as a destructive operator choice. A fetched page can steer the
model into any tool call in the admitted catalog, including calls that the
normal `tools.permissions` policy rejects. Entering a Workspace whose path would
normally be rejected also starts its Workspace MCP servers; they run unsandboxed
as the `llame` user. Enabling `bypass` therefore exposes every authenticated
user to prompt-injection and Workspace MCP risks; keep it off unless that
instance-wide trust boundary is intended.

What an effective `bypass` mode admits and records for one Run is documented in
[permission modes](../reference/permission-modes.md).

## Workspace entry

`enter_workspace` and `exit_workspace` are native host capability tools. Both
require a trusted host identity, their own `tools.allowed` entry, and their own
`tools.permissions` group.

The recommended policy in `apps/api/llame.config.jsonc.example` uses an
operator-edited `enter_workspace.path` field allow such as
`^/home/operator/projects/[^/]+/?$`, plus F1-F3 credential rejects and E1-E3
rejects for `node_modules`, temporary roots, and `Downloads`. Every directory
that this group admits is trusted to run code and read host secrets through
its Workspace MCP configuration. W1 and W2 reject case-insensitive text paths to
`.mcp.json` and `.llame`, `.agents`, or `.claude` trees for both `edit` and
`write`. These are text-only policy rejects: an in-repository alias such as a
symlink can bypass them, and there is no executor-level guard.

See [Workspace MCP](mcp-tools.md#workspace-mcp) for configuration
precedence, interpolation, client lifetime, and redaction limits.

Entry evaluates, binds, projects relative paths, and detaches on re-preparation
in [enter_workspace](../reference/tools/enter-workspace.md); releasing a binding
is [exit_workspace](../reference/tools/exit-workspace.md).

## `file://` permission clauses

Permission clauses on a `file://` alias match the decoded host path, not the URL
form, so prefer `^/path/` over `^file:///path/`; see
[tool-call permissions](tool-call-permissions.md).

## Instruction files

Per-directory project instruction files are loaded into the model's context by
directory chain and trigger; the contract is in
[instruction files](../reference/instruction-files.md).

A `read` reject rule excludes a path from every load. Add the rule to the
existing `tools.permissions` map rather than replacing what is already
configured there:

```json
{
  "tools": {
    "permissions": {
      "read": {
        "allow": true,
        "reject": [
          {
            "field": "path",
            "regex": "^/home/operator/(LLAME|AGENTS|CLAUDE)(\\.override|\\.local)?\\.md($|:)"
          }
        ]
      }
    }
  }
}
```

That is a permission recipe rather than a chain rule; see
[tool-call permissions](tool-call-permissions.md) for clause matching.

## Mutation recovery

Native mutations are fenced before they change bytes, and a redelivered Run
never repeats an effect; the contract is in
[mutation recovery](../reference/mutation-recovery.md).
