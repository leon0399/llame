# Persistent CLI connection and MCP integration

Date: 2026-09-05. Starting implementation: `05d36b1` from the first CLI bundle.
This note distinguishes repository evidence, external guidance and implementation
decisions. Behavioral requirements live in `openspec/specs/cli/spec.md`; commands
and compatibility limits live in `apps/cli/README.md`.

## Repository evidence and the requested correction

The first CLI required `--remote URL` on every invocation. The owner explicitly
rejected that behavior: once configured and enabled, remote is the default.
The new precedence is explicit invocation flag, saved enabled remote, standalone.
Login is not an execution-mode mutation, disabling is not revocation, and network
failure is not permission to send the prompt to another provider. These are
product decisions, not claims that a particular upstream CLI mandates them.

The newer bundled VISION separates standalone personal operation from Personal
Realm synchronization. Its immediate file-native intelligence cut is already
hosted by the node's durable Run loop. The local-node and federation research
separate human login, Node identity, Workspace authority and replicated personal
state. This change uses those boundaries rather than the older separately
attached root VISION/SPEC versions.

Concrete source paths checked:

- `VISION.md` and `docs/research/product-vision/2026-08-21-local-nodes-workspaces-and-distributed-execution.md`.
- `docs/research/product-vision/2026-08-21-multi-authority-federation-models.md`.
- `apps/api/src/tools/search-conversations.ts` and `conversation-read.ts`.
- `apps/api/src/knowledge/knowledge-tool-candidate-resolver.ts`.
- `apps/api/src/mcp/mcp-runtime.service.ts` and the existing MCP client/tests.
- `apps/api/openapi.json`, including chat search, Knowledge metadata and Run receipts.
- `.agents/skills/agents-best-practices/SKILL.md` and its `skills-and-connectors.md`
  reference: model proposes; runtime validates, authorizes, executes and records.

## Credentials: private local data, not configuration

The [XDG Base Directory specification](https://specifications.freedesktop.org/basedir/latest/)
separates configuration from application data, defines the default data location
as `~/.local/share`, and says relative XDG roots are invalid. Apply those directory
semantics; XDG itself is not a secret vault.

Configuration stays at `$XDG_CONFIG_HOME/llame/cli.json`. Credentials live at
`$XDG_DATA_HOME/llame/auth/<sha256-normalized-authority>.json`, defaulting to
`~/.local/share/llame/auth`. This is separate from both config and SQLite. Auth
files contain only the opaque token, authority, verified user ID and file version.
POSIX app directories must be 0700 and auth files 0600, with current-user ownership.
Reads reject links, oversize files and opened-inode changes. Writes use private
temporary files, fsync and atomic replacement. Cooperating config/auth writers
use a lock; completing an old logout cannot delete a newly stored login.

Threat model: prevent accidental exposure, credential misrouting, link-following
and cooperating-writer races. These checks do not protect against root, another
process running as the same UID, a compromised OS, or an explicitly launched
native/MCP program with that UID. There is no keychain, at-rest encryption or
Windows ACL implementation in this change. Do not synchronize credentials through
dotfiles or a future Personal Realm. Prior data under `~/.local/state/llame` can
be selected explicitly, but is not copied behind the user's back.

Human node authentication remains the existing first-party opaque Bearer session.
No OAuth authorization server or OIDC ID-token acceptance is added. External
browser PKCE/device authorization remains the separate direction recorded in
[the first-round auth research](2026-09-05-authentication-and-harness.md).

## Remote tools and Knowledge: use now, not after Realm sync

A remote CLI Run is an ordinary authenticated API Run. The node already binds
`search_conversations`, `conversation_read`, configured `knowledge_search` and
`knowledge_read`, and node-managed MCP declarations through its policy/runtime.
Their availability depends on node configuration and the authenticated owner;
connection alone is not authorization. There is no separate CLI tool loop on the
remote path and no direct client access to Postgres.

Therefore no Personal Realm work is required to use those capabilities remotely.
The new CLI commands expose existing owner-scoped endpoints: chat-list search,
Knowledge Space list/detail metadata, and a projection of the exact historical
Run tool receipt. Do not conflate chat-list search with the agent recall tool,
metadata inspection with document reads, or a historical receipt with permission
to invoke a tool now. No generic remote tool discovery/invocation endpoint exists
in the inspected API, so this implementation does not manufacture one.

A local model calling node-hosted retrieval tools would be another feature: an
authenticated, scoped tool gateway with execution/audit and data-egress contracts.
That need not equal Personal Realm replication, but neither is implemented here.
Offline remote-Knowledge availability does require an explicit caching or
replication design. Never silently download the node's memory as a shortcut.

## MCP host design and upstream guidance

[OpenCode MCP configuration](https://opencode.ai/docs/mcp-servers/) demonstrates
explicit local/remote server declarations and enablement. [Claude Code's MCP
guide](https://code.claude.com/docs/en/mcp) distinguishes transports, configuration
and authentication. Adopt explicit user-managed sources and inspectability, not
an automatic import of every project's executable connector definitions.

The [MCP tool specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
treats annotations as hints rather than an authorization boundary and defines
schema-based tool declarations. The [transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
separates stdio from Streamable HTTP and describes transport lifecycle. The
[MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
distinguishes HTTP authorization from stdio credential handling; llame node login
must not be reused as an unrelated MCP server's credential.

Implementation decisions:

- Reuse the node's MCP client, declaration admission, canonical IDs, JSON Schema
  utilities, bounds, redaction and failure policy in `@workspace/tool-runtime`.
  Move them and their tests with Git rename tracking; leave API services, RLS,
  registry/policy resolution and worker orchestration in the API. Move existing
  canonical JSON/authored-text helpers into shared runtime safety rather than
  copying them. Do not introduce another agent framework.
- Connect only explicitly enabled user-configured servers. Stdio initialization
  is already program execution and needs a trusted configured command, independent
  of later tool approval. Give it a minimal environment plus explicit values;
  no ambient human-session/model credentials. Literal argv is not a secret store.
- Resolve allowlists before model advertisement. Validate arguments before
  authorization. Default to per-call terminal approval. Optional exact upstream
  tool names in user-authored `autoApprove` are explicit durable grants, not
  inferred read-only classification. Native Workspace tools keep their stricter
  per-action terminal approval.
- Bound discovery and calls; close connections on failure/completion. Never
  automatically retry a potentially side-effecting call or reconnect mid-Run.
  Record exact initial declarations, approval decisions and correlated results.
  Local availability uses a clearly distinct CLI schema rather than pretending
  to be the API's hashed receipt format.

Remote execution does not inherit local MCP configuration. Standalone execution
can use MCP without `--native`, but does not thereby gain node capabilities.
No transparent hybrid or cross-node Workspace execution is claimed.

### Deliberate compatibility boundary

Reuse the repository's exact catalog pins (`@ai-sdk/mcp` 1.0.71 and MCP SDK 1.29.0)
and accepted negotiated revisions 2025-03-26, 2025-06-18 and 2025-11-25. This is a
bounded compatibility statement, not a claim to implement the latest MCP spec.
New protocol generations should be upgraded and verified together for API and
CLI, not silently enabled in one surface.

The inherited validator defaults to draft-07 when `$schema` is absent and supports
explicit draft-07, 2019-09 and 2020-12 dialects. This does not implement the MCP
2025 default-dialect rule in full; retain and disclose it rather than silently
altering the node's already-snapshotted admission semantics during extraction.
Schemas depending on newer keywords should declare their dialect explicitly.

MCP OAuth discovery/browser login/token refresh, legacy SSE fallback, prompts and
resources commands, sampling, elicitation and automatic project config are not
implemented. Header/env references support services with explicitly supplied
credentials; they are not a substitute for OAuth-only providers' required flows.

## Verification boundary

See [the executed verification record](2026-09-05-round-two-verification.md).
Core policy tests with an injected connection port are useful but not evidence
that SDK transport integration passes. The default CLI test command includes
production stdio/HTTP integration tests and does not skip missing dependencies.
