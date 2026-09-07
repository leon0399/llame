## Why

The native file tools deliberately constrain edits to exact replacements and
creation-only writes. Agents still need ordinary `bash`, `grep`, `jq`, Python, and
other configured tools for inspection and mass transformations. That execution
surface has different side effects, cancellation, output, retry, and isolation
semantics, so it should be proposed separately from file editing and Knowledge
submission.

## What Changes

- Define a model-facing `bash` operation for a managed executor contract.
- Run commands with a declared working directory, bounded duration, bounded
  stdout/stderr, and a safe result envelope.
- Keep configured tools and native `read`/`edit`/`write` pointed at the same
  workspace when they share an executor.
- Record command attempts before execution and refuse automatic replay of unknown
  side effects.
- Do not advertise direct host bash in this proposal; native host bash would
  expose arbitrary readable secrets and needs a separate explicit alpha decision.
- Add a replaceable managed-Sandbox adapter without changing the model command
  contract.

## Capabilities

### New Capabilities

- `bash-execution`: bounded native command execution and the future managed
  executor boundary for the shared file workspace.

### Modified Capabilities

None. Tool-calling admission waits for the managed executor/security boundary.

## Impact

The first implementation is a managed-executor contract and adapter seam. It does
not run arbitrary commands with direct host authority. A future Sandbox must
provide a secret boundary, output boundary, process isolation, and same-workspace
mount before bash is advertised to the model. Future Sandbox work can mount the
same workspace and configured tools behind a stronger isolation class.

This proposal does not add Git commits, URL fetches, Markdown processing,
provider review, or a general approval/RBAC system.
