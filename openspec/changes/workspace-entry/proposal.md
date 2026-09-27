## Why

Native `bash`, `read`, `edit`, and `write` accept only absolute paths (bash takes a literal
per-call `cwd`), so working in a project means repeating its root in every call, and nothing
brings that project's own skills or MCP servers into the chat. Leo needs this for daily work
on his own host now; it is tracked in [#974](https://github.com/leon0399/llame/issues/974)
outside ROADMAP sequencing. It uses the operator's existing native host authority
(`tools.nativeExecutorId`); it is not a Sandbox and does not implement
[#758](https://github.com/leon0399/llame/issues/758)'s remote or Sandbox placement.

The MCP read-only attestation is retired in the same change because Workspace servers cannot be
attested in advance, and the permission system (`tools.permissions`) already authorizes every
call.

## What Changes

- Add model-facing `enter_workspace(path)` and `exit_workspace()` on the native executor.
  Entry accepts an absolute path, evaluates permission on that submitted path before any
  filesystem probe, canonicalizes it, then independently requires an allow and no reject on the
  canonical path. The canonical-path decision is recorded with policy provenance. Each tool has
  its own permission group; entry is `execute_code`, exit is `write_low_risk`, neither records
  `native.attempt`, and both are idempotent over Chat state. An authorized exit on an unbound
  Chat is a harmless success.
- A Chat keeps a sticky Workspace binding with canonical root, executor id, and generation.
  `workspace_generation` increments only when an enter establishes or switches a binding, an exit
  clears a bound Chat, or a detach clears one. Same-root re-entry and exit on an unbound Chat leave
  it unchanged. A same-root entry is a no-op that returns current state without restarting clients
  or re-reading config. A switch uses a fenced compare-and-set transaction and stops old clients
  only after commit; superseded attempts do nothing.
- Each Run attempt re-checks the binding before resolving Workspace skills, `$skill`, Workspace
  MCP clients or catalog entries, or the Workspace context item. Executor absence or mismatch,
  a missing/non-directory root, a moved canonical root, loss of an `enter_workspace` allow or
  reject-free permission decision, or removal of `enter_workspace` from `tools.allowed` detaches
  immediately in its own owner-scoped delivery-fenced transaction. Detach clears the binding,
  stores a closed reason, exposes no Workspace skills or tools to that attempt, and never
  reattaches. A retry after a detach-then-fail attempt therefore remains unbound.
- While entered, relative `path` for `read`, `edit`, and `write`, and relative or omitted `cwd`
  for `bash`, resolve lexically from the root. Projection preserves a trailing separator,
  never calls `realpath`, passes the exact projected absolute string to execution and permission
  evaluation, and follows symlinks through ordinary OS behavior. `..` may leave the root.
  Relative means no leading `/` and no case-insensitive `scheme://` prefix recognized by the
  shared locator parser; unknown schemes remain `invalid_path`. Permission evaluation sees the
  projected absolute path, and a bash call without `cwd` is evaluated as if the root had been
  submitted. Relative paths remain rejected when no Workspace is entered.
- The working root is an attempt-scoped mutable cell read at dispatch. A binding change made by
  a tool call takes effect from the next model step; calls in the same step as entry or exit,
  including a same-step `read("f")`, use the root committed before that step began.
- Entry, exit, switch, and detach are narrated without changing the system prompt. The
  Workspace producer emits a rail-only current-state `snapshot` on change and after compaction;
  a detach reason is a separate `notice` in the same turn. Owner forks copy root, executor id,
  and generation but not told state or detach reason. Visitor forks of a public Chat are
  unbound and disclose no root. The owner Chat API exposes the canonical root or null; a
  non-owner receives 404, and shares and shared forks never expose it.
- Workspace skills from `.llame/skills`, `.agents/skills`, and `.claude/skills` (highest
  precedence first) join the Chat's skill sources while entered, override operator skills of the
  same name, are listed in the entry result, and are loadable through `skill://` in the entering
  Run. Missing, unreadable, non-directory, and over-limit Workspace sources contribute nothing,
  do not make operator discovery unavailable, and do not count toward the operator 32-source
  bound.
- **BREAKING** (operator contract): the MCP read-only attestation is retired for all MCP
  servers. `tools.allowed` keeps deciding which MCP tools are advertised and accepts any valid
  server name; `tools.permissions` alone authorizes calls. MCP tools carry the honest
  `unverified` classification, and write-capable MCP tools become eligible under the same gates.
  Operators who relied on the allowlist as a read-only guarantee must add permission rejects.
  Workspace MCP servers are an explicitly operator-permitted external egress path, alongside
  operator-configured MCP servers, in the tool-calling contract.
- Workspace MCP servers load from `.llame/mcp.json` over `.mcp.json`, with per-Chat clients keyed
  by Chat, canonical root, and generation; Workspace candidates and executors never enter the
  process-wide operator MCP runtime. Each process discards stale keys at attempt start before
  starting the matching key, and attempt composition layers the current Chat's Workspace resolver
  over the operator resolver. `${VAR}`, `${VAR:-default}`, `{env:…}`, and `{path:…}` interpolate
  from the executing process's environment and filesystem, including llame's own process
  environment; a stdio child receives only values declared by the Workspace entry over the MCP
  client's fixed base-environment allowlist, so an ambient llame variable not referenced by the
  entry is absent. Relative `{path:…}` values resolve from the Workspace root.
  Unresolvable values make that server unavailable with a diagnostic naming the variable or file
  location but never its value. Commands and arguments are never shell-interpreted. Only resolved
  interpolation values (excluding `:-default` literals) are protected for that server's traffic,
  diagnostics, entry result, and receipts; literal `env`/`headers` values are not protected, and
  other tools reading the same source are outside this guarantee.
- Workspace MCP clients stop on exit, switch, detach, shutdown, or idle timeout. A Workspace
  server whose id is byte-equal to an operator server defers shadowing when the operator's tools
  are already declared in the running attempt: it contributes no tools in that Run and reports
  “shadows from the next Run”; the started Workspace server shadows from the next Run under the
  same tool ids and exact-id permission groups. A Workspace id that differs from an operator id
  only by ASCII case is unavailable with reason `case-only collision with an operator server` and
  contributes no tools; operator tools are unaffected. A failed Workspace server does not shadow.
- Trusted Workspace entry adds admitted declarations through the exact mutable tool handle and
  bound-executable map used for execution. Additions are callable from the next model step; on
  exit, switch, or detach their declarations remain as keys with unavailable executors and later
  calls are refused as unavailable. Re-adding an id already retained in the running attempt
  (after exit and re-entry or a root switch) binds the new executor only when the newly admitted
  declaration is identical in memory to the retained declaration; nothing is persisted for this
  comparison. Otherwise that id contributes no executor this Run and the entry result reports it
  “available from the next Run”. Each addition is recorded at addition time in a fenced,
  owner-scoped transaction as `{ id, source: 'workspace-mcp', server, step }`, with no declaration
  hash. The owner receipt lists ids only; schemas, descriptions, hashes, shares, exports, and
  search do not expose the record. `model-system-prompts` explicitly carves out these trusted
  additions from the fixed-declaration rule.
- The shipped example permission policy documents nine groups, adding `enter_workspace` and
  `exit_workspace`; the `enter_workspace` group uses an operator-edited field allow such as
  `{ "field": "path", "regex": "^/home/operator/projects/[^/]+/?$" }`, plus F1-F3 and new
  recommended rejects on `enter_workspace.path`: E1
  `(^|[/\\])node_modules([/\\]|$)`, E2 `^/(tmp|var/tmp)(/|$)`, and E3
  `(^|[/\\])Downloads([/\\]|$)`. Every directory this group allows is trusted to run code and
  read host secrets through its Workspace MCP configuration; the other eight groups retain
  whole-tool allows. W1 on `edit.path` and `write.path` uses the case-insensitive text-reject
  regex `(?i)(^|[/\\])\.mcp\.json$`, and W2 uses
  `(?i)(^|[/\\])\.(llame|agents|claude)[/\\]`, so file tools cannot author Workspace MCP
  configuration or skills. In-repo aliases such as symlinks can bypass these text rejects; there
  is no executor-level guard.

Non-goals: Workspace instruction files such as `AGENTS.md`
([#975](https://github.com/leon0399/llame/issues/975)); Workspace config overrides and a
Workspace MCP trust model ([#976](https://github.com/leon0399/llame/issues/976)); permission
modes ([#977](https://github.com/leon0399/llame/issues/977)); remote, Sandbox, or cross-node
placement (#758); a Workspace registry or owner-registered Workspaces; filesystem confinement;
namespace-keyed permission groups; and a separate permission check before a Workspace MCP
server starts.

## Assumptions, confirmed with Leo

All native workers run on one host today; an operator who permits entry into a directory has
audited its skills and MCP configuration; and two Chats may be bound to the same directory at
once.

Permitting `enter_workspace` on a directory that any allowlisted tool can write — `bash`, native
`write`/`edit` without W1/W2, or write-capable operator or Workspace MCP tools — is equivalent to
`execute_code` and host-secret exfiltration. Workspace MCP configuration is re-read on entry and
at each new client start, and servers start without a separate permission check. W1 and W2 are
case-insensitive text rejects for model-authored config and skill paths; in-repo aliases such as
symlinks can bypass them, and there is no executor-level guard. The entry group's F1-F3 rejects
remain in force. This is an accepted audited-repository risk, not filesystem confinement.

## Capabilities

### New Capabilities

- `workspace-entry`: the `enter_workspace` / `exit_workspace` tools, the Chat binding and its
  lifecycle (re-check, immediate detach, switch, generation), relative-path projection,
  narration, and the owner-visible binding API.

### Modified Capabilities

- `bash-execution`: an omitted or relative `cwd` resolves lexically from the entered Workspace
  root and preserves a trailing separator.
- `native-file-tools`: relative `path` resolves lexically from the entered Workspace root and
  is refused when none is entered; read-only `skill://` package access publishes Workspace
  sources beneath the root.
- `tool-call-permissions`: evaluation sees the projected absolute path and implied bash `cwd`,
  entry evaluates submitted and canonical paths in order, and the recommended policy documents
  nine groups plus W1/W2.
- `tool-calling`: MCP tools are admitted by allowlist and permission rather than a `read_only`
  class; Workspace declarations can be added mid-Run, retained as unavailable after detach,
  and recorded without declaration hashes.
- `mcp-tools`: the read-only attestation is removed; Workspace servers, per-Chat generation-keyed
  lifecycle, interpolation, byte-equal deferred shadowing, case-only collision unavailability,
  and trust boundary are defined.
- `instance-config`: MCP entries in `tools.allowed` no longer require a configured server.
- `agent-skills`: Workspace skill sources, precedence, failure isolation, and same-Run loading.
- `context-injection`: the Workspace producer uses rail-only snapshots and separate detach
  notices; compaction re-establishes the current state and the skill catalog includes Workspace
  sources while entered.
- `model-system-prompts`: trusted Workspace additions are an explicit exception to fixed
  attempt-local declarations; owner receipts may list added ids but not schemas, descriptions,
  or hashes.
- `owner-chat-forks`: owner forks explicitly copy the Workspace root, executor id, and generation
  as an exception to the general rule copying no worker or native-effect state, but not told
  state or detach reason; visitor/public forks stay unbound and the binding is excluded from
  shared projections.

## Impact

- `apps/api/src/tools`: two new code-owned native tools; lexical relative-path projection shared
  by bash and native file tools and by permission evaluation.
- `apps/api/src/runs`: Run-start re-check and immediate detach; the Chat binding in tool context;
  mid-Run declaration additions and their Run record.
- `apps/api/src/db`: five Chat binding columns; a Run-level record of added declarations; one
  migration each, with RLS unchanged in shape.
- `apps/api/src/skills`, `apps/api/src/mcp`: per-Chat Workspace sources and generation-keyed
  clients; MCP classification and deferred shadowing.
- `apps/api/src/instance-config` and `llame.config.json.example`: allowlist validation and the
  nine-group policy with W1/W2.
- `apps/web`: the owner's current binding field in the Chat API and a chat-header indicator;
  a receipt row for added tools.
- Docs: `docs/native-files.md`, `docs/mcp-tools.md`, `docs/skills.md`, SPEC.md's MCP,
  native-host, skill-source, client-lifecycle, and classification lines, VISION.md's
  write-capable MCP deferral, one paragraph in the local-node research note recording the
  absolute-path exception to §5.4, and `CHANGELOG.md`.
