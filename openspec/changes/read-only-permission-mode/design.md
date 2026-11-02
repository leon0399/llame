## Context

See proposal.md for the motivation and the grilling record. The facts below are
at `a969a445` (master after `tool-result-artifacts` spill).

- **Modes.** `PERMISSION_MODES = ['default', 'bypass']` in
  `apps/api/src/tools/permissions/permission-mode.ts:1-9`. Every API DTO derives
  its enum from it. `runs.permission_mode` has the check
  `runs_permission_mode_check IN ('default','bypass')`
  (`apps/api/src/db/schema/chats.ts:412-415`). Configuration validation is
  `resolvePermissionModes` (`instance-config/config-loader.ts:1691-1735`), and
  the JSON schema enum is at `llame.config.schema.json:921-924`.
- **Effective mode.** `run-execution.service.ts:686-693` returns `bypass` only
  when the Run is `bypass` and the process enables it, otherwise `default`. The
  claim path calls it at `:1114-1115`. `ToolContext.permissionMode` carries it
  (`tools/types.ts:185`).
- **One entry point.** `decidePermission(policy, mode, decide)`
  (`tools/permissions/admit.ts:31-52`) returns a synthetic allow with
  `permission_mode_bypass` for `bypass` and calls `decide` otherwise.
  `evaluatesPermission(context)` (`admit.ts:57-59`) tells the artifact finding
  re-check whether a policy runs. `runTool` admits a call in this order:
  `admitToolCall`, `admitSshCall` (which can run `ssh -G`), the grep scope
  refusal, then `evaluateToolPermission` (`tools/runner.ts:381-399`). Callers of
  `decidePermission` are the runner (`:309-337`, and the canonical second read
  decision at `:245-296`), grep admission, Workspace binding, web-read admission, the
  binding re-check (`run-execution.service.ts:2687-2693`), Machine Workspace,
  chat creation (`chats/chat-creation-workspace.ts:225-234`), and two owner
  routes.
- **Reasons.** `PermissionDecisionReason` (`tools/permissions/types.ts:37-46`),
  fixed model texts (`tools/permissions/messages.ts`), the transcript reason
  allowlist (`runs/assistant-transcript.ts:480-504,526-534`), and the creation
  DTO enum (`chats/dto/chat-creation.dto.ts:225-239`).
- **Classification.** Each `Tool` declares one of `TOOL_CLASSIFICATIONS`
  (`tools/types.ts`). `read`, `grep`, `knowledge_search`,
  `search_conversations`, `conversation_read`, and `web_search` are
  `read_only`. `edit`, `write`, and `exit_workspace` are `write_low_risk`.
  `bash` and `enter_workspace` are `execute_code`. Every MCP tool is
  `unverified` (`mcp/mcp-runtime.service.ts:640-690`). No code reads MCP
  `readOnlyHint` or `destructiveHint`.
- **Workspace MCP.** An attempt of a bound Chat starts the Workspace MCP clients
  before context assembly (`run-execution.service.ts:1133-1134`, method
  `:2486-2496`). Entry starts them at `tools/workspace-binding.ts:233-234`.
  Clients are cached per process by chat, root, and generation
  (`mcp/workspace-mcp-clients.ts:83-85,181-206`).
  `snapshotCandidates` returns only available Workspace candidates
  (`:255-285`). The entry result reports `mcpServers` as
  `{ id, state, reason? }`, where `reason` is prose (`:48-52`).
- **Availability reminder.** A tool id that the previous dispatched Run had and
  the current manifest lacks goes to `Removed tools:` with no reason
  (`chats/tool-availability-context-item.ts:312-319`).
- **`enter_workspace`.** Host and `machine://` paths both accept `worktree`
  (`tools/workspace.ts:52,174-188`).
- **Chat creation** passes `turn.permissionMode ?? 'default'`
  (`chats/chat-creation.service.ts:478-480`).
- **Artifacts.** A spilled result writes to the owner's artifact store inside
  the call (`tools/runner.ts:459,469`). The `artifact://` locator is a `read`
  locator under the `read` group.
- **Web.** The mode union is `contexts/chat-context.tsx:5`. Selector details are
  at `app/(chat)/components/permission-mode-selector.tsx:22-40`. Sends carry
  the field only when it is `bypass` (`lib/services/chat/transport.ts:89-92,159-160`,
  `lib/services/chat/creation.ts:72-73`). Restore and repeat logic is at
  `app/(chat)/components/use-chat-engine.ts:150-159,233-257`.

## Goals / Non-Goals

**Goals:**

- A ceiling that no operator allow can widen, decided at one point for each call.
- No process that the repository declares starts in a `read-only` attempt.
- The same outcome on every worker for the same Run.

**Non-Goals:**

- Proof that an admitted read has no side effect outside llame. Egress and the
  remote read script of `ssh://` stay under the operator policy.
- Containment of host reads to the Workspace. The `read` group decides that,
  as in `default`.

## Prior art

Sources: scout reports at the pinned revisions in
[`docs/research/harnesses`](../../../docs/research/harnesses/index.md).

| Product     | Impact source                       | Read-only mode                           | Enforcement                                                           | Shell                                                   | MCP hints                       |
| ----------- | ----------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------- |
| Claude Code | Built-in Bash read-only parser      | `plan`, `dontAsk`                        | Execution gate; off in interactive terminals when bypass is available | Parser with repeated security fixes                     | Not used for approval           |
| Codex CLI   | Sandbox × approval × exec policy    | Plan is prompt-only (openai/codex#32594) | OS sandbox for shell only                                             | bwrap/Seatbelt                                          | `readOnlyHint` skips a prompt   |
| Gemini CLI  | `Kind` enum per tool class          | `plan`                                   | Policy deny at priority 40 plus a path check                          | Denied                                                  | Downgrades deny to ask          |
| OpenCode    | Flat permission keys                | `plan` agent                             | Denies `edit` only                                                    | Allowed; plan writes through shell (sst/opencode#39491) | Not read                        |
| Kilo Code   | Sealed guarded list                 | `ask`/`explore`                          | Configuration cannot widen it                                         | Allowlist plus operator blocklist                       | Not read                        |
| oh-my-pi    | `read`/`write`/`exec` tier          | `plan`                                   | Write guard in the working tree                                       | Not guarded in plan                                     | Parsed, not used                |
| goose       | MCP annotations                     | Chat, SmartApprove                       | LLM judge per call                                                    | Prompt or regex                                         | Trusted: CVE-2026-109561        |
| Qwen Code   | Shell `read-only`/`write`/`unknown` | `plan`                                   | Blocks non-read-only tools                                            | Three-state classifier                                  | Trusted (QwenLM/qwen-code#6917) |
| OpenClaw    | Tool groups and profiles            | `read-only` session                      | Omits mutation tools, denies exec                                     | Denied                                                  | Not used                        |

Lessons applied: deny shell (Gemini, OpenClaw); never trust MCP hints (goose,
Qwen); enforce at execution, not in the prompt (Codex, OpenCode); never relax
the mode because a stronger mode is available (Claude Code); keep denial text
free of a way out (QwenLM/qwen-code#6949).

## Decisions

### D1: `read-only` is one more value of the existing mode (Q7)

`PERMISSION_MODES` gains `'read-only'`. DTO enums follow it. One migration
replaces `runs_permission_mode_check` with a check over the three values. The
configuration schema enum and `resolvePermissionModes` accept it. The listing
endpoint needs no change.

Rejected: a separate boolean on the Run. Modes are exclusive, and a boolean
next to `bypass` would allow `bypass` and read-only together.

### D2: `read-only` holds on every process (D7, Leo)

All processes run one release, so every worker knows `read-only`. Only the
configuration can differ between processes. The effective-mode function returns
`read-only` for a `read-only` Run without a check of the enabled list. The
enabled list gates acceptance at the API only.

`bypass` keeps its downgrade, because a downgrade narrows `bypass`. For
`read-only` a downgrade to `default` would widen authority, and failing the Run
would add a failure path for no safety gain.

### D3: The ceiling is a call-level check in `admit.ts`, first in `runTool` (Q2, Q8)

`admit.ts` gains a pure function of the effective mode, the tool, and the
submitted arguments. It returns a reject decision with
`permission_mode_read_only`, the process policy-instance ID, and no clause
reference, or nothing. `runTool` calls it right after `admitToolCall`
succeeds and before `admitSshCall`. So a rejected `ssh://` `bash` call runs no
`ssh -G` and evaluates no group. A reject calls `onAdmitted(decision)` and
returns `permissionDeniedResult('permission_mode_read_only')`, the same record
path as a policy reject. `previewToolPermission` applies the ceiling too.

`decidePermission` treats `read-only` like `default`, so every other caller
needs no change. These callers are grep scopes and files, derived web locators
and addresses, Workspace paths, the binding re-check, chat creation, and the
artifact finding re-check. `evaluatesPermission` returns true for `read-only`.

Every model call and every system read goes through `runTool`; MCP and
Workspace MCP executors run only from `settleAdmittedExecution`. Recovery and
Continue re-execute no call. So the one check covers every dispatch.

Rejected:

- A branch inside `decidePermission`. It receives no tool identity, and
  non-call decisions (creation, re-check) must stay `default`.
- Removal of tools from declarations. It is model-visible, breaks the prompt
  prefix, and the spec forbids it for permission decisions.

### D4: Admission set: classification plus two named exceptions (Q5′, Q8)

The ceiling admits a call when the tool classification is `read_only`, when
the tool is `exit_workspace`, or when the tool is `enter_workspace` and the
submitted arguments have no `worktree` property. The `worktree` test reads the
submitted arguments, so it applies before any probe on host and `machine://`
paths.

Classification becomes a security property: a reclassification changes what
`read-only` admits. Reviewers check classification changes for that reason.

Rejected: a required per-tool predicate. Only `enter_workspace` depends on its
arguments today. Revisit when the subagent tool and the
[#1536](https://github.com/leon0399/llame/issues/1536) attestation bring the
argument-dependent rows past about five.

### D5: Reason and text (Q6)

`permission_mode_read_only` joins `PermissionDecisionReason`, its fixed text in
`messages.ts`, and the transcript allowlist. The creation DTO enum does not
change, because creation decisions never pass the ceiling (D7). The text is
fixed in the spec scenario `The rejection text is fixed`:

> Tool call rejected before execution. This Run permits only reads and
> Workspace entry or exit without a worktree. Do not retry this call, disguise
> the same action through different commands or tools, or delegate it to
> another agent. In-run approval is unavailable. Continue with other permitted
> work; if this action is required, explain the blocked step to the user.

It names no permission mode and no setting.

### D6: Workspace MCP does not start (Q5′, Q10)

One rule: a `read-only` attempt passes no Workspace MCP key to anything that
starts, holds, or reads a client.

- **Attempt start.** `startWorkspaceMcp` still stops stale clients: it calls
  `stopForChat` when the Chat is unbound and the stale-generation discard
  otherwise. It skips `startForChat` when the mode is `read-only`.
- **Attempt.** No key goes to `composeAttemptCatalog`,
  `attemptDynamicResolver`, or `beginWorkspaceAttempt`. A cached client set
  for the key stays untouched for a later `default` attempt, and its idle
  sweep is not held.
- **Entry.** The binding transition and the `unchanged` path branch on the
  mode before `startForChat`, `stateForKey`, `transferAttempt`, and
  `addToAttempt`. `mcpServers` comes from the existing readers:
  `readWorkspaceMcpConfig` (both files) for a host root and the Machine
  `mcp.servers` request for a `machine://` root. Neither starts a process.
  Each returned server is `unavailable` with reason
  `not started in a read-only Run`. A file-level or server-level entry that
  the reader already reports as unavailable keeps its own reason. A same-root
  re-entry reads the configuration again for this listing.
- **Reminder.** A previously available Workspace tool id goes to
  `Removed tools:`, through the existing comparison. No new reason code.

### D7: Chat creation keeps `default` path semantics (Q9)

The creation Workspace step already passes the request mode to
`decidePermission`, which treats `read-only` like `default` (D3). Creation
already answers 422 for any mode that the process does not enable, through
`resolvePermissionMode`. No code change: the deltas generalize the requirement
text that named `bypass` only, and tests cover the `read-only` cases.

### D8: Web

`PERMISSION_MODE_DETAILS` gains `read-only` with the title `Read-only` and the
description `Reads only. Edits, commands, and MCP tools are refused.` Send and
creation conditions become `mode !== "default"`. Regenerate already repeats
`latestRun.permissionMode`, so only the send condition changes for it. The
trigger stays non-destructive for `read-only`. A reopened chat starts at
`default`; the present `bypass` restore from usage is not extended. The web
client and the web copy of the live protocol are regenerated.

### D9: No usage segment (deviation from D3 of the grilling)

`usage.permissionMode` stays `bypass`-only. The Run response and the context
receipt report `read-only`. Recording it in usage would modify the
`durable-runs` and `run-usage-accounting` requirements for an informational
badge.

## Risks / Trade-offs

- [An admitted read can still leak data to a remote host through a URL] ->
  Documented as a non-goal. The `read` and `web_search` groups decide egress.
- [A future tool is classified `read_only` but mutates] -> D4 makes
  classification a security property. The review guide treats a
  classification change as a security change.
- [The `ssh://` read runs a bounded read script remotely] -> It is a
  llame-authored read. A `read` reject on the `ssh://` prefix removes it.
- [The GitHub web-read adapter sends a GraphQL `POST`] -> The request is a
  query. A `read` reject on its host removes it.
- [Switch between modes in a Chat with Workspace MCP misses the prompt cache]
  -> Bounded to Chats with Workspace MCP servers. Documented in the reference.
- [`search_conversations` sends the query to the embedding provider] -> Same as
  `default`. Egress is a non-goal.

## Migration Plan

One generated Drizzle migration drops `runs_permission_mode_check` and adds it
again with the three values, in one transaction, as
`20260927213738_short_wallflower.sql` added it. Existing rows satisfy the new
check. Rollback is the reverse migration, once no row holds `read-only`.

## Open Questions

None that changes the specs or the task breakdown.

## Revision history

- **v1 (2026-11-03):** Initial draft from the grilling record.
- **v2 (2026-11-03):** Local review round 1 (spec consistency 3 P0, 7 P1,
  12 P2; feasibility 1 P0, 4 P1, 7 P2). Fixed: the rejection text is in the
  spec; `workspace-entry` creation modes are modified; entry listing reuses
  the existing readers and states Machine, malformed-file, and same-root
  cases; the ceiling runs before `admitSshCall`; the key reaches no resolver
  or hold; stale clients still stop; the live protocol is regenerated; the
  creation DTO enum is unchanged; restore is not extended; STE fixes.
  Rejected: an operator note about rolling upgrades, because all processes
  run one release (D2).
