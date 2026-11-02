## Why

An owner who wants the assistant to look at a repository, a Knowledge Space, or
the web without any risk of change has no per-send choice for that. The
operator policy is one per process, and `bypass` only widens it. A third Run
permission mode, `read-only`, caps the operator policy for one send. It is also
the authority shape that future isolated child Runs need: a bound Workspace, no
mutation, and no repository-declared process.

Issue: [#1548](https://github.com/leon0399/llame/issues/1548). Follow-up:
[#1536](https://github.com/leon0399/llame/issues/1536) (operator attestation of
read-only MCP tools). Tracking: [#1488](https://github.com/leon0399/llame/issues/1488).

## What Changes

- `tools.permissionModes` accepts `"read-only"`. A chat send, a chat creation
  message, and a follow-up request accept `permissionMode: "read-only"` when
  the API process enables it.
- A `read-only` attempt admits a tool call only when the tool is classified
  `read_only`, or the call is `exit_workspace`, or the call is
  `enter_workspace` without `worktree`. Every other call, including `bash`,
  `edit`, `write`, and every MCP tool, gets `permission_denied` with the new
  reason `permission_mode_read_only`, before the operator policy is evaluated.
- An admitted call then passes the operator policy exactly as in `default`. No
  allow widens the mode, and no reject is relaxed.
- A `read-only` attempt starts no Workspace MCP server and uses no Workspace
  MCP client that an earlier attempt started. Workspace entry reports each
  Workspace MCP server as unavailable with a fixed reason.
- A Run accepted as `read-only` executes as `read-only` on every process. The
  enabled-mode list gates acceptance only, so a configuration change can never
  widen a queued `read-only` Run.
- The web composer lists `read-only` with a title and a description and sends
  any selected mode other than `default`.
- Chat creation with `worktree` under `read-only` still creates the worktree:
  creation is the owner's own action, and its path decisions evaluate as in
  `default`.

No change is **BREAKING**. The default configuration enables only `default`.

## Assumptions, confirmed with Leo

From the grilling record in [#1548](https://github.com/leon0399/llame/issues/1548):

- Q1 A: the mode prevents mutation only. Egress stays under the `read` and
  `web_search` policy, so `read-only` is not an exfiltration control.
- Q2 A: the mode is a ceiling over the operator policy, not a replacement.
- Q3 A: `bash` is rejected outright. No command parser.
- Q4 A: every MCP tool is rejected. Operator attestation is #1536.
- Q5′ A: plain `enter_workspace` and `exit_workspace` are admitted, `worktree`
  entry is rejected, and Workspace MCP does not start.
- Q6 A: a new reason, `permission_mode_read_only`, with fixed inert text.
- Q7 A: the operator opts in through `tools.permissionModes`.
- Q8 A: admission uses the existing tool classification plus two named
  workspace exceptions. The ceiling is decided before the policy.
- Q9 A: chat creation with `worktree` is allowed under `read-only`.
- Q10 B: a skipped Workspace MCP server reports a fixed read-only reason.
- D7, superseded by Leo: assume all processes run the same release. So no
  worker can lack `read-only` support; only configuration can differ. A Run
  accepted as `read-only` stays `read-only` on every process (see
  design D2).

Assumptions that follow but were not asked:

- The mode value is `read-only`; the decision reason is
  `permission_mode_read_only`.
- Reads that the system issues itself (instruction imports, skill activation,
  prompt imports) are `read` calls, so the mode admits them.
- Artifact spill of an admitted call's result still writes to the owner's
  artifact store. llame-internal records (audit rows, decisions, artifacts)
  are not host or remote mutation.
- Owner routes (checkout registration, worktree removal) keep `default`
  semantics; the mode governs a Run only.

## Deviation from the grilling record

- D3 is dropped: a `read-only` turn is not recorded in `usage.permissionMode`
  and gets no usage-badge segment. Recording it would modify the
  `durable-runs` and `run-usage-accounting` requirements that fix
  `permissionMode` to `bypass` only. The Run response and the context receipt
  already report the accepted mode. Leo to confirm.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `permission-modes`: MODIFIED `Chat sends accept an optional permission mode`
  (the third value), `The permission mode is not model-visible` (one stated
  exception: a `read-only` attempt has no Workspace MCP declaration, and the
  availability reminder reports it as removed), and `The composer offers the
  enabled modes per chat` (sends any non-default mode).
- `tool-call-permissions`: MODIFIED `A Run's effective permission mode selects
  whether the policy is evaluated` (the `read-only` value and its resolution).
  ADDED `A read-only attempt admits only reads and plain Workspace
  transitions`, `A read-only rejection is recorded before the policy is
  evaluated`, and `A read-only attempt rejects worktree entry`.
- `instance-config`: MODIFIED `Operator configuration enables Run permission
  modes` (accepts `"read-only"`).
- `mcp-tools`: ADDED `A read-only attempt starts and uses no Workspace MCP
  client` and `Workspace entry reports a server that read-only did not start`.
- `chat-creation`: MODIFIED `The Workspace step uses the request permission
  mode` (any mode the process does not enable answers 422; `read-only`
  decides paths as `default`).
- `workspace-entry`: MODIFIED `The Workspace binding is Chat-scoped and
  persists across Runs` (a creation request can use any enabled mode; a
  `read-only` request decides paths as `default`).

Deliberately unchanged, with the reading under which each holds:

- `tool-call-permissions` `Safe decision provenance and non-fatal rejection`:
  its fixed-template list is read as extended by the template that the ADDED
  `A read-only rejection is recorded before the policy is evaluated` fixes
  for its own reason.
- `tool-call-permissions` `Execution policy is frozen per process and
  reevaluated after restart`: "resolved against the enabled modes of the
  process that executes it" holds under the modified resolution rule, which
  takes the enabled modes as input and ignores them for `read-only`.
- `instance-config` `Operator tool permissions compile before process startup
  completes`, `mcp-tools` `MCP eligibility and execution authorization are
  separate`, `tool-calling` `Each execution attempt applies the operator
  availability gate and per-call permission`, `workspace-entry` `Workspace
  tools require native authority, allowlisting, and their own permission
  gates`, the Purpose of `native-file-tools`, and `native-file-tools` `Web
  locators are fetched by the native read tool`: "governs an attempt whose
  effective permission mode is `default`" (or "a `default`-mode attempt")
  also governs an admitted call of a `read-only` attempt, because the
  modified effective-mode requirement says a `read-only` attempt evaluates
  the policy exactly as `default`.
- `web-search` `The call removes the results that the read permission group
  rejects`: "the effective permission mode is `default` here" holds for
  `read-only`, which removes rejected hosts like `default`.
- `mcp-tools` `Workspace MCP clients are isolated, generation-keyed, and
  lifecycle-managed per Chat`, `workspace-entry` `Entry switches one binding
  and exit clears it` and `Each Run attempt re-checks the binding and detaches
  invalid state`, `owner-chat-forks` `The fork's Chat row carries the source's
  frozen context`, `remote-machines` `Machine Workspace MCP lifetime follows
  local Workspace rules`, and `tool-calling` `Trusted in-Run tool additions
  are admitted and made unavailable with Workspace state`: each statement
  that starts clients, adds Workspace declarations, or makes a same-root
  re-entry skip the configuration read governs a `default` or `bypass`
  attempt. The two ADDED `mcp-tools` requirements state their precedence for
  a `read-only` attempt. The attempt-start discard of stale clients still
  applies to `read-only`.
- `mcp-tools` `Workspace MCP configuration is portable and protects
  interpolated values` and `remote-machines` `Workspace MCP servers of a
  Machine Workspace run from the Machine`: a `read-only` entry lists servers
  through these same readers, so file precedence, interpolation, protected
  values, and Machine-side resolution are unchanged. The listing starts no
  process.
- `tool-calling` `Tool registry with mandatory safety classification`: the
  classification set and its meaning are unchanged; the mode reads it.
- `permission-modes` `Usage records a bypassed turn` and `The usage badge marks
  a bypassed turn`: unchanged, see the deviation above.
- `turn-actions`: Continue and Regenerate carry a mode generically, so
  `read-only` follows the existing rules.

## Impact

- API: the mode constant, configuration schema and validation, the
  `runs.permission_mode` check constraint (one migration), effective-mode
  resolution, the call-level ceiling in the runner, the decision reason
  vocabulary and its fixed message, the transcript reason allowlist,
  Workspace MCP start, hold, resolver, and entry for a `read-only` attempt,
  regenerated OpenAPI and the API copy of the live WebSocket protocol.
- Web: the composer selector details, the send condition, the regenerated
  client and live protocol. A reopened chat starts at `default`, as the
  composer requirement says; the code's present `bypass` restore from usage
  is not extended to `read-only`.
- The permission-modes Purpose, which describes two modes, is updated at
  spec sync.
- Docs: `docs/product/reference/permission-modes.md`, the operator
  configuration example, `docs/product/operator/native-files.md`.

## Non-Goals

- An egress or exfiltration control. Egress stays under the operator policy.
- A shell command parser or an OS read-only sandbox for `bash`.
- MCP read-only attestation ([#1536](https://github.com/leon0399/llame/issues/1536)).
- Child Runs or subagents. This mode is their prerequisite, not their design.
- A change to the mode of a running Run ([#998](https://github.com/leon0399/llame/issues/998)).

## Acceptance

- With `["default", "read-only"]` enabled, an owner selects `read-only`, the
  model calls `bash`, `edit`, and an MCP tool, and each call returns
  `permission_denied` with reason `permission_mode_read_only` and does not
  start.
- In the same Run, `read` and `grep` calls that the policy allows succeed, and
  a `read` call that the policy rejects is rejected with the policy reason.
- In a Chat bound to a Workspace with a `.mcp.json` stdio server, a
  `read-only` Run starts no process for that server.
- A Run accepted as `read-only`, then claimed after the operator removes
  `read-only` from `tools.permissionModes`, still rejects `bash`.
