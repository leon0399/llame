## Context

See [proposal.md](proposal.md) for why. The decisions below were settled with Leo in the #977
design session on 2026-09-27; this document records how they are built.

Reasoning effort is the closest existing contract and the pattern this change reuses end to end:
it is validated at accept time in `chat-loop.service.ts` (422 `effort_not_available`, no message
or Run), persisted as `runs.effort` so a configuration edit cannot change a queued Run, returned
from the claim transaction rather than the queue payload, carried on `RunResponse`, the context
receipt response, and assistant `usage` through `turn-telemetry.ts`, and selected in the web
composer through `ChatContext` and `prepareSendMessagesRequest`.

Permission admission today has five evaluation sites, each calling `evaluatePermission` with the
process's `CompiledPolicy`:

| Site                      | Code                            | Evaluates                                                 |
| ------------------------- | ------------------------------- | --------------------------------------------------------- |
| Per-call gate             | `tools/runner.ts`               | submitted and projected arguments                         |
| Web-read derived locators | `tools/web-read/admission.ts`   | redirect hops, alternates, suffix and `llms.txt` probes   |
| Web-read addresses        | `tools/web-read/admission.ts`   | each resolved address as an address locator, rejects only |
| Workspace entry           | `tools/workspace.ts`            | submitted path, then canonical path                       |
| Workspace re-check        | `runs/run-execution.service.ts` | the bound root, once per attempt                          |

Their handling of an absent policy already differs: the runner returns no decision, Workspace
entry refuses with `no_allow`, and address admission admits no address. Bypass therefore cannot
be implemented as "no policy"; it must be an explicit decision every site takes.

## Goals / Non-Goals

**Goals:**

- One seam that every evaluation site uses, so a site cannot keep enforcing the policy under
  `bypass` or skip it under `default`.
- A durable, owner-private record per bypassed call that survives reload and fork.
- Deploy order independence: an API that accepts `bypass` and a worker that does not enable it
  must still produce a safe, truthfully recorded Run.

**Non-Goals:**

- Relaxing any gate other than `tools.permissions`.
- Per-user gating, `auto`, mid-Run mode changes, or restoring composer selections (see the
  proposal's scope).

## Decisions

### D1. Wire value `bypass`, not `yolo`

The enum is `"default" | "bypass"` in the DTO, the database check constraint, the configuration,
and the decision reason `permission_mode_bypass`. Renaming a stored enum later needs a
migration. Prior art names the same mode `bypassPermissions` (Claude Code) and
`--dangerously-bypass-approvals-and-sandbox` (Codex); `bypass` suffices because the field is
already `permissionMode`. Rejected: `yolo` (issue #977's working name), which the repository's
naming rule excludes.

### D2. Operator gate is a list with `default` required

`tools.permissionModes` is an ordered array of known mode values, default `["default"]`. Startup
rejects an empty list, an unknown value, a duplicate, or a list without `default`, naming the
field. `auto` (#999) later becomes one more known value, and the enabled-mode listing (D9)
returns the list unchanged. Rejected: a boolean `tools.permissionBypass`, which forces a breaking
configuration change when a third mode arrives.

There is no per-user gate: no instance-level authorization signal exists yet (#158). An operator
who enables `bypass` enables it for every authenticated user; the runbook says so.

### D3. The accepted mode is persisted on the Run

`runs.permission_mode` is `text not null default 'default'` with a check constraint over the known
values, added by one generated Drizzle migration; existing rows take `default` from the column
default, which is the truth for every Run that predates the feature. The accept transaction writes
the validated mode beside `effort`. The claim transaction returns it with `effort`, so the queue
payload is never the source of truth. `RunResponse.permissionMode` and
`ContextReceiptResponse.permissionMode` are always present and report the accepted mode.

The mode is validated after `modelId` and `effort` so an unavailable model or effort is reported
first, matching the existing ordering; all three are validated before any database work.

### D4. One permission-admission seam carries the effective mode

`ToolContext` gains an optional `permissionMode: 'default' | 'bypass'`; absent means `default`,
so every existing context and test fixture keeps policy evaluation. A single function beside the
evaluator, `admitPermission(context, options)`, returns the bypass decision when the context's
mode is `bypass` and otherwise calls `evaluatePermission` exactly as today. The runner, both
web-read admission paths, and both Workspace entry checks call it instead of the evaluator. The
Workspace re-check, which runs before a `ToolContext` exists, takes the attempt's effective mode
directly and skips evaluation under `bypass`.

The effective mode is computed once per attempt at claim time:
`accepted === 'bypass' && config.tools.permissionModes.includes('bypass') ? 'bypass' : 'default'`.
Configuration is frozen per process, so per attempt equals per executing process.

Rejected: threading a flag through each call site separately, which leaves nothing to stop a
future evaluation site from forgetting it; and swapping in an allow-everything `CompiledPolicy`,
which would lose the distinct decision reason and match clause references that do not exist.

### D5. Bypass decisions are recorded with their own reason

The allow branch of `PermissionDecision` widens its `reason` to
`'matched_allow' | 'permission_mode_bypass'`. A bypass decision carries the process's
`policyId` and `reference: null`. It flows through the existing records unchanged: `tool.requested`
before dispatch, the completion payload's derived-locator decisions for web hops, alternates, and
probes, and the canonical Workspace entry record. Address records are written only for refused
addresses, and under `bypass` none is refused, so none is written. Durable transcript
reconstruction in `runs/assistant-transcript.ts` accepts the new reason and still rejects any
unknown one.

The policy-instance ID is kept because the executing process's configuration is what enabled the
bypass; it lets an owner correlate a decision with a process restart like any other decision.

### D6. A worker that does not enable `bypass` applies its policy

Under D4 an accepted `bypass` Run executes as `default` on a worker whose configuration lacks
`bypass`. Each call records the policy decision that actually applied. This extends the existing
rule that each invocation uses its executor process's policy, and it always resolves to the
stricter outcome. Rejected: failing the Run before any model request, which turns an operator
restart into failed Runs for a mode the operator deliberately withdrew.

### D7. Workspace bindings follow the Run's mode

Under `bypass` the per-attempt re-check skips the `enter_workspace` evaluation; every other
re-check condition (executor, root existence, `realpath`, allowlisting) still applies. Under
`default` the re-check evaluates as today, so a Workspace that only `bypass` could enter is
detached with `permission_rejected` by the next `default` Run, and a later `bypass` Run must enter
it again.

### D8. The mode never reaches model context

The mode is not rendered into the system prompt, recorded in the system-prompt receipt, or
authored as a context item, and a mode change between turns is not an effective-context change.
The model learns about limits only through `permission_denied` results, as today. A mode switch
therefore never invalidates the provider prompt cache.

### D9. Enabled modes are listed by their own endpoint

`GET /api/v1/permission-modes` (cookie-authenticated, operation `listPermissionModes`) returns
`{ "modes": [{ "value": "default" }, { "value": "bypass" }] }` in configuration order, from the
API process's configuration. The object wrapper matches `ModelsResponse` so fields can be added
without a breaking change. Items carry no labels: the web client owns display text for the
closed enum. Rejected: a generic instance-capabilities document (speculative shape) and no
discovery (every user sees a `bypass` option that fails on send).

### D10. Usage records the attempt's effective mode

`buildTurnTelemetry` writes `usage.permissionMode: "bypass"` only when the attempt that produced the
message executed under an effective `bypass`; `default` is omitted, like an absent effort. The
effective mode, not the accepted one, is recorded so the badge never claims `Bypass` on a turn
whose calls a D6 worker checked. Forks copy `usage` verbatim, so a copied turn keeps its marker;
public shares and public forks receive no `usage`, so they show nothing. Historical usage is not
backfilled.

### D11. Web selector state is per chat and never persisted

`ChatProvider` is mounted in the `(chat)` layout, so model and effort selections survive
navigation between chats. The permission mode must not: `ChatContext` stores it with the chat id
it was chosen in, and any other chat id reads `default`. Nothing is written to storage, so a
reload also reads `default`. The send transport includes `permissionMode` only when it is
`bypass`, through the same latest-value reference pattern `use-chat-engine.ts` uses for effort.

`PermissionModeSelector` sits at the left of `PromptInputToolbar`, outside the model/effort
`ButtonGroup`. It is a dropdown with radio items, each with a title and a one-line description,
queried through a generated `useListPermissionModes` hook, and renders nothing when the listing
has fewer than two modes, including while it is loading or failed. While `bypass` is selected its
trigger uses the destructive `Button` variant; no new theme token is introduced. If a send returns
`permission_mode_not_available`, the client invalidates the listing and resets the chat's mode to
`default`.

## Risks / Trade-offs

- [An operator enables `bypass` on a shared instance] → every authenticated user can switch off
  every reject, including cloud-metadata address rejects. Mitigation: off by default; the runbook
  states the instance-wide effect and that per-user gating waits for #158.
- [Prompt injection under `bypass`] → a fetched page can steer the model into any tool call the
  catalog offers. Mitigation: none beyond the owner's choice and `tools.allowed`; the runbook says
  so, and #999 is the mode that answers it.
- [Workspace MCP under `bypass`] → entering a directory starts its Workspace MCP servers, which run
  unsandboxed as the llame user, without E1–E3. Mitigation: documented in the runbook.
- [A missed evaluation site] → one site keeps rejecting under `bypass`, or worse, a future site
  bypasses under `default`. Mitigation: D4's single seam plus a test per site in both modes.
- [Mixed accepted and effective modes] → `RunResponse` says `bypass` while the badge omits it
  after a D6 downgrade. Accepted: `RunResponse` reports what the owner asked for, the badge and
  tool parts report what ran.

## Migration Plan

One additive column with a default; no backfill, no dual path. Rollback before any `bypass` Run
exists is a column drop. After `bypass` Runs exist, rolling back the API leaves their tool parts
carrying a reason the old reconstruction rejects; transcript reconstruction would drop those
decisions rather than fail, so rolling back is safe but loses that provenance. Deploy the API and
workers together; D6 covers a worker that lags the API's configuration.
