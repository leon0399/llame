# Design

## Context

See proposal.md for motivation. The facts below were read at `1bab08dc` and shape the approach.

- `ToolContext` is built once per Run in `RunExecutionService.executeRun` from trusted inputs
  (`runId`, `userId`, `chatId`, `nativeExecutorId`, `nativeDeliverySequence`, tenant DB,
  SkillCatalog, permission policy) and has no working-directory field
  (`run-execution.service.ts:872-899`, `tools/types.ts:43-95`).
- The native file tools refuse relative paths in `@workspace/native-file-tools`
  (`packages/native-file-tools/src/path.ts:182-184`, `mutate.ts:109-117`). Bash defaults its
  `cwd` to `BASH_WORKING_DIRECTORY` or `process.cwd()` (`tools/env.ts:1-6`, `tools/bash.ts:21-30`).
- `runTool` validates the schema, then `evaluateToolPermission` evaluates the submitted
  arguments and, for native file tools, a second time over `nativeFileProjection` values
  (`tools/runner.ts:145-224`, `tools/permissions/locator-projection.ts`).
- The Chat row already carries per-chat baselines and told sets for the skill catalog and the
  recency digest, re-baked against the latest compaction and copied by forks
  (`db/schema/chats.ts:23-51,113-159`, `chats/fork-copy.ts:34-98`,
  `chats/skill-turn-state.ts:81-178`).
- One process-wide SkillCatalog reads its configured sources live on every snapshot
  (`skills/skill-catalog.ts:107-150`); `skill://` resolves through it per read.
- `McpRuntimeService` is one process-wide provider that starts every configured server at boot
  and labels each executor `classification: 'read_only'` (`mcp/mcp-runtime.service.ts:449`).
  `groupEligibleTurnToolCandidates` admits a candidate only if allowlisted and either
  `read_only` or a host-capability tool (`tools/turn-tool-catalog.ts:369-402`).
- The attempt catalog is composed once per attempt (`effective-context-resolver.ts:25-91`); the
  model client passes the tool record to `streamText` and restricts steps through `prepareStep`
  (`models/openai-model-client.ts:102-122`). The system-prompt receipt records no tools;
  `runs.turn_tool_availability` and `runs.context_items` are separate Run records
  (`db/schema/chats.ts:382-425`).
- A Run's native executor is bound to `runs.worker_id` on its first host-bound call
  (`runs/native-files-repository.ts:13-24,91-113`).

## Goals / Non-Goals

**Goals:** one binding model shared by every native tool, with every relative path turned into
an absolute path before permission evaluation; per-Chat Workspace skills and MCP clients
without touching process-wide operator state; tools added during a Run that are both callable
and recorded.

**Non-Goals:** filesystem confinement, a Workspace registry, Run routing between hosts, and
sharing MCP clients between Chats.

## Decisions

### D1. The binding lives on the Chat row

Add nullable `workspace_root` (canonical absolute path), `workspace_executor_id`, and
`workspace_told` (the root last narrated to the model, or null) to `chats`, beside the existing
baseline columns and under the same owner RLS. A Chat has at most one binding, so a separate
table would add a join and a lifecycle for no gain. Forks copy the root and executor id but not
`workspace_told`: a fork anchored before the entry has no narration in its copied prefix, so its
first turn narrates the current Workspace. Alternative rejected: a binding keyed per branch. llame has no branch
objects; a fork already is the branch.

### D2. Entry and exit are code-owned host-capability tools

`enter_workspace` and `exit_workspace` join the native file tools and `bash` in
`isHostCapabilityTool`, require `tools.nativeExecutorId`, their own `tools.allowed` entries, and
their own `tools.permissions` groups. `enter_workspace` accepts `{ path }` (absolute) and:

1. rejects a non-absolute or NUL-containing path as `invalid_path`;
2. resolves `realpath` and requires a directory;
3. evaluates permissions over both the submitted and the canonical path; any reject vetoes;
4. if already entered, performs the exit steps for the old binding (D7, D8);
5. writes the binding in its own owner-scoped transaction fenced by `nativeDeliverySequence`,
   the fence native mutations already use, so a superseded attempt cannot write it;
6. discovers Workspace skills and starts Workspace MCP clients, adding their declarations to the
   running attempt (D9);
7. returns the canonical root, a host-authority statement, the Workspace skill list, and each
   Workspace server's state.

The binding is written before skills and MCP start, so a server that fails to start never
leaves the Chat half-entered. `exit_workspace` clears the binding and stops the clients. It
evaluates its own permission group like any call; the operator can therefore lock exit out,
which Leo accepted.

### D3. One projection function for execution and permission evaluation

A pure `resolveWorkspacePath(root, value)` turns a relative value into
`path.resolve(root, value)`; `..` may leave the root. It feeds both the executor arguments and
`evaluateToolPermission`. For `read`, `edit`, `write` `path` and `bash` `cwd`, the value
evaluated is the projected absolute path; the submitted relative text is not matched. A `bash`
call without `cwd` is evaluated as if `cwd: <root>` had been submitted. Absolute values and
`kb://`, `skill://`, and web locators pass through unchanged. With no binding, a relative
`path` stays `invalid_path`, and bash without `cwd` keeps its process default. The shell
`command` text is still matched only as text, as today.

Alternative rejected: evaluating both the submitted and the projected text. A reject literal
`..` would then block every relative escape, including targets the policy allows.

### D4. Re-check at each attempt's preparation

Accepted-turn preparation reads the binding and detaches when any of these holds: this worker
has no `nativeExecutorId`, or its id differs from `workspace_executor_id`; the root is no longer
an existing directory; or `enter_workspace` permission now rejects the stored root. Detach
clears the binding in the same staged terminal transaction as the other chat-row state and stages
a `workspace` notice (D6) on the triggering user message. A detached binding is never restored.
A retried attempt repeats the check against current state.

### D5. Tool context carries the root, not the binding

`ToolContext` gains `workspaceRoot?: string`, set from the re-checked binding at Run start and
updated in memory by `enter_workspace` / `exit_workspace` for later steps of the same attempt.
Tools read it only through D3.

### D6. Narration uses a told-state producer

A new `workspace` context-item producer compares the binding with `workspace_told` at each
accepted turn. When they differ it emits a `notice` naming the current root, or that none is
entered, together with the host-authority statement, and stages `workspace_told` for update.
This is rule-3 residency from `context-injection`: current state that can change more often
than compaction, narrated as a rail item. A newly active compaction resets `workspace_told` to
null, so the next turn re-establishes a bound Chat's Workspace; a Chat with no root and nothing
narrated gets no notice. Detach adds its reason to the same item. Inside a Run, the enter and
exit tool results carry the narration. The system prompt is never involved.

### D7. Workspace skills are extra sources for one Chat

`SkillCatalog.getSnapshot(extraSources?)` accepts ordered extra sources, ranked last so they
override configured sources by name. For a bound Chat those are
`<root>/.claude/skills`, `<root>/.agents/skills`, `<root>/.llame/skills`, lowest first, so
`.llame` wins. `skill://` resolution, the turn skill state, and explicit `$skill` activation pass
the Chat's extra sources. Because discovery is already live, no cache is invalidated. The told
set is keyed by name, so a Workspace skill that shadows an operator skill of the same name is
not announced as new; the activation output already shows the absolute directory, which reveals
the source.

### D8. Workspace MCP clients are owned per Chat in the executing process

A new `WorkspaceMcpClients` provider keeps a map `chatId -> clients` in the worker process that
executes the Run. On entry, or when an attempt starts for a bound Chat whose clients are not
running in this process, it reads `.llame/mcp.json` merged over `.mcp.json` by server name.
Entries use the portable shape: a missing `type` with `command` means `stdio`, and
`http`/`streamable-http` mean remote. It interpolates `${VAR}`, `${VAR:-default}`, `{env:…}`,
and `{path:…}`, with every resolved value added to the protected-value set. A stdio child
defaults its `cwd` to the root and resolves a relative `cwd` from it. Clients reuse the existing
client, discovery, admission, and bounds code. Clients stop on exit, switch, detach, process
shutdown, and after 30 minutes with no Run on the Chat in this process; the next Run starts them
again. A malformed file, an invalid server name, or an unsupported transport leaves entry
successful and is reported as that server's unavailable state.

Shadowing: when a Workspace server has started and its id equals an operator server id, the
Chat's candidates drop the operator server's tools and use the Workspace server's under the same
`mcp__<server>__<tool>` ids and the same exact-id permission groups. A Workspace server that
failed to start does not shadow.

Alternative rejected: one shared client per root and server. Servers such as Playwright keep
per-session state, which would then leak between Chats.

### D9. Tools added mid-Run extend the bound tool record in place

A bounded spike against installed `ai@6.0.256` with `MockLanguageModelV3` showed that adding a
key to the tool record passed to `streamText` from inside a tool's `execute` makes the tool
declared on the next step and executable on it. `prepareStep` cannot return new tools, but
`streamText` re-reads the record for each step. Entry therefore admits Workspace declarations
through the same allowlist, classification, and schema admission as attempt composition and
inserts them into the attempt's record. A pinned regression test guards the SDK behavior. A
`prepareStep` `activeTools` restriction, such as the step cap, still applies. Exit and switch
remove their keys, and a call to a removed id is refused as unavailable.

Each addition is appended to a new owner-scoped `runs.added_tool_declarations` JSONB array:
`{ id, source: 'workspace-mcp', server, step, declarationHash }`, written in the Run's terminal
transaction. The owner receipt view lists them as tools added during the Run. The next Run's
catalog includes the Chat's Workspace tools from its start, so the existing `tool-availability`
producer announces them normally.

Alternative rejected: ending the stream after entry and starting a continuation with a new tool
set. That reopens usage aggregation, step counting, and the step cap.

### D10. MCP classification and eligibility

MCP executors carry a new SPEC §13.5 member, `unverified`: llame makes no claim about their
effects. `groupEligibleTurnToolCandidates` admits MCP candidates by source (allowlisted MCP id),
no longer by `read_only`. Code-owned tools keep today's gate. `tools.allowed` validation keeps
the `mcp-tool-id-v1` grammar and the 64-character bound but drops the configured-server lookup,
so `mcp__playwright__*` is valid before any Playwright server exists. A typo is no longer caught
at startup; it is visible in the availability disclosure.

## Risks / Trade-offs

- [Mutating the SDK tool record relies on undocumented per-step reads] → pin a test at the
  installed version that asserts declaration on the next step and execution; an SDK upgrade that
  breaks it fails CI.
- [Repository-supplied `{path:…}` and `${VAR}` can exfiltrate host secrets] → accepted by
  assumption: permitted Workspaces are audited. #976 owns a trust model. Resolved values are
  still redacted from results and diagnostics.
- [Retiring the attestation makes existing operator allowlists write-capable] → **BREAKING**
  changelog entry and a `docs/mcp-tools.md` migration note telling operators to add permission
  rejects for mutating MCP tools.
- [Exact-id permission groups make large Workspace servers tedious] → accepted; every call to
  an unlisted tool is rejected, so the failure mode is safe.
- [Two Chats bound to one checkout can overwrite each other] → accepted, as with absolute paths
  today.
- [A permission rejecting `exit_workspace` traps the model in a Workspace] → accepted; D4 still
  detaches on executor, directory, or permission change.
- [Workspace MCP children outlive a crashed worker] → the stdio shutdown path already escalates
  to a forced kill on process shutdown; a hard crash leaves orphans, as operator stdio servers
  would today.

## Migration Plan

Two additive migrations: the Chat binding columns (L1) and `runs.added_tool_declarations`
(L4). Both are nullable or default-empty, so rollback drops columns with no data loss beyond
bindings. L3 is a contract change with no data migration; its rollback restores the
`read_only` gate.
