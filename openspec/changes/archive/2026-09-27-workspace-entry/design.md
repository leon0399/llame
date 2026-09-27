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
- `McpRuntimeService` is one process-wide provider that starts every operator-configured server at
  boot and labels each executor `classification: 'read_only'` (`mcp/mcp-runtime.service.ts:449`).
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
without touching process-wide operator state; tools added during a Run become callable from
the next model step and remain in the attempt's in-memory catalog.

**Non-Goals:** filesystem confinement, a Workspace registry, Run routing between hosts, and
sharing MCP clients between Chats.

## Decisions

### D1. The binding lives on the Chat row

Add nullable `workspace_root` (canonical absolute path) and `workspace_executor_id`, integer
`workspace_generation`, nullable `workspace_told` (the root last narrated to the model, or null)
with nullable `workspace_told_from` (the compaction the narration belongs to, like
`skill_catalog_rebaked_from`),
and nullable `workspace_detach_reason` (one of `executor_mismatch`, `executor_absent`,
`root_missing`, `root_moved`, `permission_rejected`, or `tool_not_allowed`) to `chats`, beside
the existing baseline columns and under the same owner RLS. `workspace_generation` increments only
when an enter establishes or switches a binding, an exit clears a bound Chat, or a detach clears
one; same-root re-entry and exit on an unbound Chat leave it unchanged. A Chat has at most one
binding, so a separate table would add a join and a lifecycle for no gain.

Owner forks copy the canonical root, executor id, and generation as an explicit exception to the
general fork rule copying no worker or native-effect state. They do not copy `workspace_told`,
`workspace_told_from`, or `workspace_detach_reason`: a fork anchored before entry has no narration
in its copied prefix, and a detach reason belongs only to the attempt that observed it. The fork's
first turn therefore narrates a copied binding, while a detached source remains unbound. Visitor
forks and public share projections copy no Workspace binding and disclose no root; the binding is
explicitly part of the shared-path exclusion list. The owner's Chat API exposes the canonical root
or null, while a non-owner receives 404.
Alternative rejected: a binding keyed per branch. llame has no branch objects; a fork already is
the branch.

### D2. Entry and exit are code-owned host-capability tools

`enter_workspace` and `exit_workspace` join the native file tools and `bash` in
`isHostCapabilityTool`, require `tools.nativeExecutorId`, their own `tools.allowed` entries, and
their own `tools.permissions` groups. `enter_workspace` is classified `execute_code` because it
can start host processes; `exit_workspace` is `write_low_risk`. Neither records
`native.attempt`. Both bind `runs.worker_id` through the existing native-executor binding used by
other host tools and are idempotent over Chat state, so a queue retry after a committed binding
re-runs to the same final state. An authorized exit on an unbound Chat is a harmless success.

At most one Workspace transition call may take effect in a model step. The first `enter_workspace`
or `exit_workspace` call executed in that step claims the transition slot; every later transition
call returns the non-fatal `workspace_transition_conflict` result before changing the binding,
generation, clients, declarations, or other state.

`enter_workspace` accepts `{ path }` (absolute) and follows this order:

1. reject a non-absolute or NUL-containing path as `invalid_path`;
2. the runner evaluates the `enter_workspace` permission group on the submitted absolute path;
   this decision must obtain an allow and must not match a reject;
3. perform a read-only delivery-fence check, before any filesystem probe;
4. canonicalize with `realpath` and require an existing directory;
5. evaluate the same permission group on the canonical path; this decision must independently
   obtain an allow and must not match a reject, and its policy provenance is recorded like a
   derived-locator decision;
6. if the canonical root equals the current binding, return the current state as a no-op success
   without incrementing `workspace_generation`, restarting clients, or re-reading configuration;
   otherwise recheck the delivery fence in the owner-scoped transaction and perform a fenced
   compare-and-set switch or initial bind, checking the fence before the write and stopping old
   clients only after the new binding commits;
7. after the fenced write commits, discover Workspace skills and start Workspace MCP clients,
   adding admitted declarations to the running attempt (D7-D9);
8. return the canonical root, a host-authority statement, the Workspace skill list, and each
   Workspace server's state.

The binding is written before skills and MCP start, so a server that fails to start never leaves
the Chat half-entered. `exit_workspace` clears the binding and stops clients. A denied call has
no effect; the operator can lock exit out with its own permission group, while preparation still
detaches on the causes in D4. The recommended entry group uses a field allow plus F1-F3 and the
E1-E3 protected-path rejects; the other eight groups retain whole-tool allows.

### D3. One lexical projection function for execution and permission evaluation

A pure `resolveWorkspacePath(root, value)` resolves a relative value lexically like POSIX
`path.posix.resolve`, while preserving a submitted trailing separator. It never calls `realpath`.
The executor receives exactly the projected absolute string; symlinks inside that string are
followed by the operating system as for any absolute path. `..` may leave the root.

For this rule, "relative" means a value that does not start with `/` and does not have a
`scheme:` prefix recognized by the shared locator parser (the `scheme://` comparison is
case-insensitive). Recognized locator schemes pass through unchanged, while an unknown scheme
remains `invalid_path`; a value such as `app.ts/` projects to an absolute path that still ends
in `/`. The same projection feeds `read`, `edit`, `write` `path` values and `bash` `cwd` values
into both execution and `evaluateToolPermission`. A `bash` call without `cwd` is evaluated as if
the Workspace root had been submitted. The submitted relative text is not matched.

Absolute values and `kb://`, `skill://`, and web locators pass through unchanged. With no
binding, a relative native-file path stays `invalid_path`, and bash without `cwd` keeps its
process default. The shell `command` text is still matched only as text, as today.

Alternative rejected: evaluating both the submitted and projected text. A reject literal `..`
would then block every relative escape, including targets the policy allows.

### D4. Re-check at each attempt's preparation

Attempt preparation on the worker re-checks the binding before resolving effective Workspace skill
sources, `$skill` activation, Workspace MCP clients or catalog entries, or the `workspace`
producer. When a check fails, it immediately detaches in its own owner-scoped transaction,
fenced by the Run's current delivery, rather than waiting for the completed-only terminal
transaction. The transaction clears the binding, increments `workspace_generation`, and stores
the closed `workspace_detach_reason`; the attempt performs no Workspace skill activation,
`skill://` resolution, or Workspace tools and narrates the detach. An already-frozen
skill-catalog baseline may still list Workspace skills for that attempt; the next accepted turn's
skill-catalog notice removes them.

The causes are exhaustive and never restore the binding:

- the executing worker has no native executor (`executor_absent`) or a different executor id
  (`executor_mismatch`);
- `realpath(workspace_root)` no longer equals the stored canonical root
  (`root_moved`), or the root is missing or not a directory (`root_missing`);
- the current `enter_workspace` permission group evaluates the stored canonical root as its
  `path` value and fails to obtain an allow or matches a reject (`permission_rejected`);
- `enter_workspace` is no longer in `tools.allowed` (`tool_not_allowed`).

The `workspace` producer consumes the stored reason for its detach notice and clears the reason
when the narration's Run completes. A retry after an attempt detached and then failed therefore
still finds the Chat unbound even if executor, directory, and permission checks would now pass;
only a new successful `enter_workspace` can bind it again.

### D5. Tool context carries the root through an attempt-scoped cell

The working root lives in an attempt-scoped mutable cell read by the runner and permission
evaluator at dispatch. The cell also carries a per-model-step transition claim. The first
`enter_workspace` or `exit_workspace` call executed in a step claims it; a later transition call
returns the non-fatal `workspace_transition_conflict` result without changing binding, generation,
clients, declarations, or other state. `ToolContext` is spread-copied for each call, so mutating
a field on one copy does not propagate. `enter_workspace` and `exit_workspace` update the cell
only for later model steps: a binding change made by a tool call takes effect from the next model
step. Tool calls issued in the same step as an `enter_workspace` or `exit_workspace` call are
projected from the root committed before that step began, including a same-step `read("f")`.
The cell is initialized only from the binding that passed D4.

### D6. Narration uses snapshot and notice rail items

A new `workspace` context-item producer compares the current binding with the told state at each
accepted turn. For that comparison, accepted-turn preparation treats the stored `workspace_told`
as null whenever `workspace_told_from` differs from the Chat's latest compaction identity; when
they match, it uses the stored told root. A small complete current-state statement is rail-only:
when the root differs it emits a `snapshot` naming the canonical root, or stating that none is
entered, together with the host-authority statement, and stages `workspace_told` together with
`workspace_told_from` (the latest compaction identity) for update. The same accepted-turn
transaction that commits the successful turn writes both values and clears any consumed detach
reason; the compaction path never writes Chat state. This current-state snapshot may be re-emitted
after compaction because its repetition is cheaper than putting the baseline in the prefix.

When preparation detached the binding, the detach reason is a separate `notice` in the same
turn, consumed from `workspace_detach_reason`; it is not folded into the root snapshot. The
reason is cleared when that narration's Run completes. A Chat with no root and no pending detach
reason that has never narrated a Workspace gets no item. Inside a Run, enter and exit tool results
carry the immediate state narration. The system prompt is never involved.

### D7. Workspace skills are extra sources for one Chat

`SkillCatalog.getSnapshot(extraSources?)` accepts ordered extra sources, ranked last so they
override configured sources by name. For a bound Chat these are
`<root>/.claude/skills`, `<root>/.agents/skills`, and `<root>/.llame/skills`, lowest first, so
`.llame` wins. The Chat's effective skill sources feed `skill://` resolution, the turn skill
state, and explicit `$skill` activation.

During attempt preparation, a detaching attempt does not resolve these Workspace sources, activate
`$skill`, or resolve `skill://`; its skill-catalog baseline content may already list Workspace
skills when that baseline was frozen in the accepted-turn transaction before worker preparation.
The next accepted turn's skill-catalog notice removes those entries.

A missing, unreadable, non-directory, or over-limit Workspace skill directory contributes
nothing and never makes the operator catalog or discovery unavailable. Workspace sources do not
count toward the operator 32-source bound. Native-file-tools skill locators continue to provide
live read-only package access and publish resolved Workspace skill directories discovered beneath
those three root-relative locations.
Because discovery is live, no process-wide cache is invalidated. The told set is keyed by name,
so a Workspace skill that shadows an operator skill is not announced as new; activation output
already shows its absolute directory, which reveals the source.

### D8. Workspace MCP clients are owned per Chat in the executing process

A `WorkspaceMcpClients` provider keeps process-local clients keyed by
`(chatId, canonical root, workspace_generation)`. Workspace candidates and executors never enter
the process-wide operator MCP runtime. On entry, or when an attempt starts for a bound Chat whose
matching key is not running in this process, it reads `.llame/mcp.json` merged over `.mcp.json` by
server name. At every attempt start it stops any clients held for that Chat whose key does not
match the current binding, then starts the matching key. Exit, switch, and detach stop clients in
the executing process; other processes discard stale clients at their next attempt for that Chat
or at the 30-minute idle timeout.

Attempt composition takes Workspace candidates from the per-Chat registry for the current
`(chatId, canonical root, workspace_generation)` key, applies shadowing per Chat, and passes bound
executable resolution an attempt-scoped resolver: the Workspace resolver for that key layered over
the operator resolver. A Workspace client is never registered in the process-wide operator map.
Entries use the portable shape: a missing `type` with `command` means `stdio`, and `http` or
`streamable-http` means remote. `${VAR}`, `${VAR:-default}`, `{env:…}`, and `{path:…}` resolve
from the executing process's environment and filesystem, including llame's own process
environment. A stdio child receives only the values declared by that Workspace entry, merged over
the MCP client library's fixed base-environment allowlist; an ambient llame process variable not
referenced by the entry is absent. A relative `{path:LOCATION}` resolves from the Workspace root.
An unresolvable token (an unset variable without a default or an unreadable file) makes that
server unavailable with a diagnostic naming the variable or file location, never its value.
Resolved values are not re-scanned, and commands and arguments are never shell-interpreted.

For a Workspace server, every non-empty remote `headers` value, literal or interpolated, is added
to that server's protected-value set. Resolved interpolation values in stdio `command`, `args`, or
`env` fields are also protected except a literal supplied solely as a `:-default` fallback. Literal
stdio `command`, `args`, and `env` text is not protected solely because it is literal. Redaction is
guaranteed for that server's traffic, diagnostics, entry result, and receipts; another tool that
independently reads the same source is outside this guarantee. A stdio child defaults its `cwd` to
the root and resolves a relative `cwd` from it. Clients reuse the existing client, discovery,
admission, and bounds code. A malformed file, invalid server name, or unsupported transport leaves
entry successful and reports that server as unavailable.

Alternative rejected: one shared client per root and server. Servers such as Playwright keep
per-session state, which would then leak between Chats.

### D9. In-Run additions extend the bound in-memory tool record in place

The mutable handle is the exact tool object assigned to `streamOptions.tools` by the wire client
(each wire copies `input.tools` through `disableStrictToolSchemas`), together with the
bound-executable map used at execution (`resolveBoundExecutableTools` /
`snapshot-tool-execution.ts`). A bounded spike against installed `ai@6.0.256` showed that adding
a key from inside a tool's `execute` makes the declaration visible on the next step and
executable there; `prepareStep` cannot return new tools but `streamText` re-reads the record for
each step. A pinned regression test guards this behavior, while `prepareStep` restrictions such
as the step cap still apply.

Entry admits Workspace declarations through the same source, allowlist, classification, and
schema checks as attempt composition and inserts them into that handle and executable map.
Declarations are never removed as keys: on exit, switch, or detach their executors become
unavailable while the attempt-local declarations remain, and later calls to those ids are
refused as unavailable. This matches the canonical rule that a dynamic tool which loses its
executor retains its declaration with an unavailable executor.

Shadowing is deferred for declarations already present in a running attempt. If an entering
Workspace server's id is byte-equal to an operator server whose tools are already declared, the
Workspace server contributes no tools in that attempt and the entry result says it "shadows from
the next Run"; operator tools retain their executors for the rest of that attempt. Attempt-start
composition always resolves the live binding, so the successfully started Workspace server
shadows the operator server from the next attempt that composes this binding, whether that is a
retry attempt of the same Run or a later Run, under the same tool ids and exact-id permission
groups. A Workspace server id that differs from an operator server id only by ASCII case is
reported unavailable with reason `case-only collision with an operator server` and contributes no
tools; operator tools are unaffected. A Workspace server that failed to start does not shadow.

If an id already present in the running attempt is re-added after exit and re-entry, or after a
switch between roots defining that server, the newly admitted declaration binds an executor only
when it is identical in memory to the retained declaration; nothing is persisted for this
comparison. Otherwise that id contributes no executor in this attempt and the entry result reports
it "available from the next Run". A subsequent attempt re-composes from the live binding rather
than recovering the earlier attempt's catalog. Declarations are never replaced or removed as keys:
on exit, switch, or detach their executors become unavailable while the attempt-local declarations
remain, and later calls to those ids are refused as unavailable.

Tool availability is resolved at runtime: each attempt resolves Workspace tools from the live
binding at its start, and each active step uses the current in-memory declarations. Nothing records
a Run's tool set as a restriction.

These additions exist only in the attempt's memory; no Run record or owner-facing view stores them.
The `model-system-prompts` rule therefore carves out trusted Workspace additions from the otherwise
fixed admitted-declaration set for that attempt.

A subsequent attempt's catalog includes currently admitted Workspace declarations from its start,
so the existing `tool-availability` producer announces them normally. Alternative rejected: ending
the stream after entry and starting a continuation with a new tool set, which reopens usage
aggregation, step counting, and the step cap.

### D10. MCP classification and eligibility

MCP executors carry `unverified` in SPEC §13.5: llame makes no claim about their effects.
`groupEligibleTurnToolCandidates` in `tools/turn-tool-catalog.ts` admits MCP candidates by
source (an allowlisted MCP id), not by `read_only`. The same source-based gate is applied by
`resolveDynamicToolBinding` in `runs/snapshot-tool-execution.ts:164`, by the
`isClassifiedTool`/`resolveAdvertisedTools` closed list in `tools/registry.ts:36-44,125`, and
when unavailable MCP entries are built in `mcp-runtime.service.ts:199`; none may retain a
`read_only` requirement for MCP.

Code-owned tools keep today's host-capability gate. `tools.allowed` validation keeps the
`mcp-tool-id-v1` grammar and 64-character bound but drops the configured-server lookup, so
`mcp__playwright__*` is valid before any Playwright server exists. A typo is no longer caught at
startup; it is visible in availability disclosure. Every admitted MCP call still needs an
applicable `tools.permissions` group.
The tool-calling egress scenarios name Workspace MCP servers alongside operator-configured MCP
servers as the only operator-permitted external-tool path; neither source bypasses
`tools.permissions` or receives llame tenant authority.

Before invoking an MCP operation, the worker durably records its dispatch attempt through the
native-attempt recovery path. If a worker fails after dispatch may have started and before the
result is known, the Run recovers the operation as `outcome_unknown` and stops, and a queue retry
does not invoke that MCP operation again.

## Risks / Trade-offs

- [Mutating the SDK tool record relies on undocumented per-step reads] → pin a test at the
  installed version that asserts declaration on the next step and execution; an SDK upgrade that
  breaks it fails CI.
- [Repository-supplied `{path:…}` and `${VAR}` can exfiltrate host secrets] → accepted under
  the audited-repository assumption, including llame's own process environment as an
  interpolation source. Permitting `enter_workspace` on a directory that any allowlisted tool can
  write — `bash`, native `write`/`edit` without W1/W2, or write-capable operator or Workspace MCP
  tools — is equivalent to `execute_code` and host-secret exfiltration: Workspace MCP config is
  re-read on entry and at each new client start, and servers start without a separate permission
  check. W1/W2 are case-insensitive text rejects for `.mcp.json` and
  `.llame|.agents|.claude` paths; in-repo aliases such as symlinks can bypass those rejects, and
  there is no executor-level guard. F1-F3 remain on the `enter_workspace` group. For Workspace
  entries, every non-empty remote `headers` value is protected whether literal or interpolated;
  resolved interpolation values in stdio `command`, `args`, and `env` are protected except
  `:-default` fallback literals, while literal stdio `command`, `args`, and `env` values remain
  unprotected solely because they are literal. Values are redacted only within the owning server's
  diagnostics, entry result, and receipts; other tools that independently read the same source
  are outside that guarantee.
- [Retiring the attestation makes existing operator allowlists write-capable] → **BREAKING**
  changelog entry and a `docs/mcp-tools.md` migration note telling operators to add permission
  rejects for mutating MCP tools.
- [Exact-id permission groups make large Workspace servers tedious] → accepted; every call to an
  unlisted tool is rejected, so the failure mode is safe.
- [Two Chats bound to one checkout can overwrite each other] → accepted, as with absolute paths
  today.
- [A permission rejecting `exit_workspace` traps the model in a Workspace] → accepted; D4 still
  detaches on executor, directory, allow, or permission change.
- [Workspace MCP children outlive a crashed worker] → the stdio shutdown path already escalates
  to a forced kill on process shutdown; a hard crash leaves orphans, as operator stdio servers
  would today.

## Migration Plan

The core layer adds six Chat columns: `workspace_root`, `workspace_executor_id`,
`workspace_generation`, `workspace_told`, `workspace_told_from`, and `workspace_detach_reason`. The
mid-run-tools layer adds no Run columns: declarations and bound executors exist only in the active
attempt's in-memory handle and map. The binding columns are nullable, with generation defaulting to
zero and the detach reason nullable. Each migration is additive, transactional, deterministic,
and must be applied and tested against a populated database with owner RLS unchanged in shape.

The mcp-authorization layer is a contract change with no data migration; the workspace-mcp
client map is process-local and needs no schema migration. Rollback drops the new columns and
restores the read-only MCP gate, losing only unshipped binding records. No migration may expose
binding roots through shares, exports, search, or another owner's RLS scope.

## Revision history

- v1 (initial) — Initial workspace-entry design and staged implementation plan.
- v2 (this revision) — Added generation and detach-reason binding columns, immediate fenced
  detach, ordered re-check causes, and retry semantics.
- v2 (this revision) — Tightened entry authorization order, same-root no-op/CAS switching,
  idempotent classifications, and owner-visible authority boundaries.
- v2 (this revision) — Defined lexical projection, relative-locator rules, and trailing
  separator preservation.
- v2 (this revision) — Made attempt root timing, snapshot/notice narration, skill-source
  failure isolation, and owner/visitor fork behavior explicit.
- v2 (this revision) — Keyed Workspace MCP clients by generation, documented host interpolation
  and redaction scope, deferred shadowing, and retained unavailable declarations.
- v2 (this revision) — Made Workspace additions in-memory and enumerated every MCP read-only
  gate, then split implementation layers and their checks.
- v3 (this revision) — Q1 byte-equal shadowing; Q2 in-memory declaration re-add identity; Q3
  Workspace protected-value scope; Q4 binding-generation semantics; Q5 detach notice/snapshot
  condition; Q6 field-scoped entry policy; Q7 case-insensitive W1/W2 text rejects and alias
  bypass; Q8 broad trust-input boundary; Q9 owner-only Workspace host-path context exception;
  Q10 binding authority boundary; Q11 stdio environment isolation; Q12 per-Chat MCP resolver
  isolation; Q13 complete mcp-authorization SPEC.md ownership and egress-task split; Q14 proposal
  layer review-budget exception.
- v4 (PR #979 review) — F1 protects every non-empty Workspace remote header while leaving literal
  stdio `command`, `args`, and `env` values unprotected unless interpolated; F2 records MCP dispatch
  attempts before invocation and recovers uncertain retries as `outcome_unknown`; F3 permits at
  most one Workspace transition per model step; F4 re-checks `enter_workspace` against the stored
  canonical root; F5 orders the delivery-fence check before filesystem probing; F6 permits an
  already-frozen Workspace skill-catalog baseline in a detaching attempt but no activation,
  `skill://` resolution, or tools; F7 carries the revised MCP authorization contract through the
  canonical Purpose and operator documentation.
- v5 — Made trusted Workspace additions in-memory only; runtime tool resolution is authoritative,
  and no Run record stores the tool set.
- v6 — Added the sixth Chat binding column `workspace_told_from`, with compaction-identity
  comparison and an accepted-turn transaction write site; made Workspace shadowing and composition
  attempt-keyed, including same-Run retries; made MCP recovery deterministically stop with
  `outcome_unknown` and added the MODIFIED tool-calling checkpoint block; and left literal stdio
  `command`, `args`, and `env` text unprotected unless interpolated.
- v7 — Split terminal settlement of open calls: an open `bash`, native mutation, or MCP call
  whose `native.attempt` is recorded without a result settles as `outcome_unknown`; every other
  open call follows the termination settlement rules, which keep cancellation distinct from a tool
  failure.
