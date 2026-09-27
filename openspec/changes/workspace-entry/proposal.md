## Why

Native `bash`, `read`, `edit`, and `write` accept only absolute paths (bash takes a literal
per-call `cwd`), so working in a project means repeating its root in every call, and nothing
brings that project's own skills or MCP servers into the chat. Leo needs this for daily work
on his own host now; it is tracked in [#974](https://github.com/leon0399/llame/issues/974)
outside ROADMAP sequencing. It uses the operator's existing native host authority
(`tools.nativeExecutorId`); it is not a Sandbox and does not implement
[#758](https://github.com/leon0399/llame/issues/758)'s remote or Sandbox placement.

The MCP read-only attestation is retired in the same change because Workspace servers cannot
be attested in advance, and the permission system (`tools.permissions`) already authorizes
every call.

## What Changes

- Add model-facing `enter_workspace(path)` and `exit_workspace()` on the native executor.
  Entry takes an absolute path, canonicalizes it, and is authorized by `tools.permissions`
  against both the submitted and canonical path. Each tool has its own permission group.
- A Chat keeps a sticky Workspace binding (canonical root and executor id) across Runs. Each
  Run start re-checks the root against current permissions and existence; a reject, a missing
  directory, or a different executor claiming the Run detaches the Chat completely, as if
  `exit_workspace` had been called, and never reattaches. Entering while entered switches.
- While entered, relative `path` for `read`, `edit`, `write` and relative or omitted `cwd` for
  `bash` resolve from the root; `..` may leave it. Permission evaluation sees the projected
  absolute path, and a `bash` call without `cwd` is evaluated as if the root had been
  submitted. Relative paths remain rejected when no Workspace is entered.
- Entry, exit, switch, and detach are narrated to the model as context items and the current
  Workspace is re-established at compaction; the system prompt never changes. Owner forks
  copy the binding.
- Workspace skills from `.llame/skills`, `.agents/skills`, `.claude/skills` (highest first)
  join the Chat's skill sources while entered, override system skills of the same name, are
  listed in the entry result, and are loadable through `skill://` in the entering Run.
- **BREAKING** (operator contract): the MCP read-only attestation is retired for all MCP
  servers. `tools.allowed` keeps deciding which MCP tools are advertised and accepts any valid
  server name; `tools.permissions` alone authorizes calls. MCP tools carry an honest
  non-`read_only` classification, and write-capable MCP tools become eligible under the same
  gates. Operators who relied on the allowlist as a read-only guarantee must add permission
  rejects.
- Workspace MCP servers from `.llame/mcp.json` over `.mcp.json`, with `${VAR}`, `{env:…}`, and
  `{path:…}` interpolation from the host, start per Chat on entry and stop on exit, switch, or
  detach. Their tools are callable in the entering Run. A Workspace server that starts shadows
  an operator server of the same name, sharing its tool ids and exact-id permission groups.
- Tool declarations added in the middle of a Run are recorded on the Run and shown in the
  owner's receipt.
- The shipped example permission policy documents nine groups, adding `enter_workspace` and
  `exit_workspace`.

Non-goals: Workspace instruction files such as `AGENTS.md`
([#975](https://github.com/leon0399/llame/issues/975)); Workspace config overrides and a
Workspace MCP trust model ([#976](https://github.com/leon0399/llame/issues/976)); permission
modes ([#977](https://github.com/leon0399/llame/issues/977)); remote, Sandbox, or cross-node
placement (#758); a Workspace registry or owner-registered Workspaces; filesystem confinement;
namespace-keyed permission groups; a permission check before a Workspace MCP server starts.

Assumptions, confirmed with Leo: all native workers run on one host today; an operator who
permits entry into a directory has audited its skills and MCP configuration; two Chats may be
bound to the same directory at once.

## Capabilities

### New Capabilities

- `workspace-entry`: the `enter_workspace` / `exit_workspace` tools, the Chat binding and its
  lifecycle (re-check, detach, switch), relative-path projection, narration, and the owner-visible
  binding.

### Modified Capabilities

- `bash-execution`: an omitted or relative `cwd` resolves from the entered Workspace root.
- `native-file-tools`: relative `path` resolves from the entered Workspace root and is refused
  when none is entered.
- `tool-call-permissions`: evaluation sees the projected absolute path and the implied bash
  `cwd`; the recommended policy documents nine groups.
- `tool-calling`: MCP tools are admitted by allowlist and permission rather than a
  `read_only` class; tool declarations can be added in the middle of a Run and are recorded on
  it.
- `mcp-tools`: the read-only attestation is removed; Workspace servers, their per-Chat
  lifecycle, interpolation, and shadowing.
- `instance-config`: MCP entries in `tools.allowed` no longer require a configured server.
- `agent-skills`: Workspace skill sources, precedence, and same-Run loading.
- `context-injection`: the Workspace producer's residency and compaction re-establishment; the
  skill catalog includes Workspace sources while entered.
- `owner-chat-forks`: a fork copies the Workspace binding.

## Impact

- `apps/api/src/tools`: two new code-owned native tools; relative-path projection shared by
  bash and the native file tools and by permission evaluation.
- `apps/api/src/runs`: Run-start re-check and detach; the Chat binding in tool context;
  mid-Run declaration additions and their Run record.
- `apps/api/src/db`: Chat binding columns; a Run-level record of added declarations; one
  migration each, with RLS unchanged in shape.
- `apps/api/src/skills`, `apps/api/src/mcp`: per-Chat Workspace sources and clients; MCP
  classification.
- `apps/api/src/instance-config` and `llame.config.json.example`: allowlist validation and the
  nine-group policy.
- `apps/web`: a chat-header indicator of the current binding and a receipt row for added tools.
- Docs: `docs/native-files.md`, `docs/mcp-tools.md`, `docs/skills.md`, SPEC.md's MCP and
  native-host lines, VISION.md's write-capable MCP deferral, one paragraph in the local-node
  research note recording the absolute-path exception to §5.4, `CHANGELOG.md`.
