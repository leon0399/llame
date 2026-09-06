## Why

The native file tools deliberately constrain edits to exact replacements and
creation-only writes. Agents still need ordinary `bash`, `grep`, `jq`, Python, and
other configured tools for inspection and mass transformations. That execution
surface has different side effects, cancellation, output, retry, and isolation
semantics, so it should be proposed separately from file editing and Knowledge
submission.

## What Changes

- Add a model-facing `bash` operation for an explicitly trusted native executor.
- Run commands with a declared working directory, bounded duration, bounded
  stdout/stderr, and a safe result envelope.
- Keep configured tools and native `read`/`edit`/`write` pointed at the same
  workspace when they share an executor.
- Record command attempts before execution and refuse automatic replay of unknown
  side effects.
- Add a replaceable managed-Sandbox adapter later without changing the model
  command contract.

## Capabilities

### New Capabilities

- `bash-execution`: bounded native command execution and the future managed
  executor boundary for the shared file workspace.

### Modified Capabilities

- `tool-calling`: admit `bash` as an exact alpha-native execution tool with
  pre-start attempt persistence and no automatic replay after unknown effects.

## Impact

The first host runs as an alpha native OS-user capability. It is not a hosted
multi-user sandbox and does not implement permission policy. The executor must
disclose its authority and keep command output bounded. Future Sandbox work can
mount the same workspace and configured tools behind a stronger isolation class.

This proposal does not add Git commits, URL fetches, Markdown processing,
provider review, or a general approval/RBAC system.
