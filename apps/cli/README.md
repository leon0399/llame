# llame CLI

A first-party TypeScript terminal with two execution modes and a saved user-selected default:

- **Local:** its own configuration, model endpoint, SQLite conversations and
  bounded agent loop. No llame account, Hub, Postgres or running web app.
- **Remote:** a thin authenticated client of an existing llame API node. That
  node owns execution, providers, policy and durable Runs.

Logging in never changes the default mode. A remote connection does not enroll
this machine, synchronize history, upload its Workspace or forward provider keys.
A local runtime identity is not a cryptographic Node enrollment identity.

## Build and launch

Use the repository's pinned Node version (`.node-version`, minimum 22.19) and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=cli --concurrency=1
node apps/cli/bin/llame.cjs --help
```

In the examples below, `llame` means `node /absolute/path/to/llame/apps/cli/bin/llame.cjs`.
For an interactive POSIX shell, a convenient checkout-specific alias is:

```sh
alias llame="node '$PWD/apps/cli/bin/llame.cjs'"
```

A portable, built distribution can be produced without a registry publish:

```sh
pnpm exec turbo run package:standalone --filter=cli --concurrency=1
node apps/cli/standalone/bin/llame.cjs --help
```

Copy the **whole** `standalone` directory, including its production dependency
closure, to a compatible machine. It needs Node but no npm install or database server.
Packaging requires installed dependencies and successful workspace builds. It fails
closed on a missing production dependency, retaining an existing distribution.
Third-party package licenses/notices are included; platform-specific optional
dependencies, when installed, are copied for the build platform, not cross-compiled.
It contains no model, provider configuration or credentials. The CLI is not
published to npm by this change. Node 22's built-in SQLite emits an experimental
warning; it goes to stderr, not JSONL stdout.

## Persistent remote default

Enable a remote once, then use ordinary commands without repeating its URL:

```sh
llame remote enable https://api.example.com
llame auth login --email you@example.com
llame run "Use my node's configured tools"
llame --local run "Use only my local configuration for this invocation"
llame remote disable
```

`remote enable` changes routing, not authentication. `remote disable` retains the
URL and saved login; `remote enable` with no URL re-enables it. Use
`llame auth logout` to revoke even while disabled; auth commands retain the saved
authority independently of the execution default. Explicit `--local` has no auth.
`--remote URL` and `--local` override routing for one invocation. Failures never
change mode. Only the selected config's `remote` fields are inspected for remote
routing; local provider/MCP secrets are not resolved or transmitted.

```json
{ "version": 1, "models": [], "remote": { "enabled": true, "url": "https://api.example.com" } }
```

The default data directory is now `$XDG_DATA_HOME/llame` or
`~/.local/share/llame`; credentials are individual `auth/<authority-sha256>.json`
files, separate from `~/.config/llame/cli.json` and from `state.sqlite`. The entire
data directory is 0700 and credential files are 0600, owned by the current OS
user. This is filesystem access control, not encryption/keychain storage.
Do not sync the auth directory with a Personal Realm or a public dotfiles repo.
To continue using round-one state in `~/.local/state/llame`, explicitly select it
with `--data-dir` or `LLAME_DATA_DIR`; there is no silent copying of credentials.

## Standalone configuration

```sh
llame config init
```

This writes a private example configuration and refuses to overwrite an existing
file. Replace `CHANGE_TO_YOUR_INSTALLED_MODEL` with the exact model name served by
**your already-running** endpoint. llame does not install or start inference.

The default config is `$XDG_CONFIG_HOME/llame/cli.json`, falling back to
`~/.config/llame/cli.json`. Use `--config /absolute/file.json` or `LLAME_CONFIG`
for a different file. Configuration is strict versioned JSON; unknown fields
and invalid model references fail closed.

```json
{
  "version": 1,
  "defaultModel": "local",
  "models": [
    {
      "id": "local",
      "model": "CHANGE_TO_YOUR_INSTALLED_MODEL",
      "baseUrl": "http://127.0.0.1:11434/v1"
    },
    {
      "id": "private-endpoint",
      "model": "YOUR_PROVIDER_MODEL",
      "baseUrl": "https://inference.example/v1",
      "apiKey": "{env:MY_MODEL_API_KEY}"
    }
  ],
  "maxSteps": 8,
  "maxOutputTokens": 4096,
  "maxContextBytes": 100000,
  "timeoutSeconds": 120
}
```

Keep the config file mode `0600` on POSIX. Remove unused model entries rather
than leaving unresolved credential references: all configured entries are
validated when local configuration loads. The existing llame single-pass
`{env:...}` and `{path:...}` interpolation is reused; it is not shell expansion.
Resolved credentials are protected values, redacted before persistence/rendering.
Do not paste keys into prompts or put bearer secrets in command arguments.

Local inference supports **OpenAI-compatible streaming Chat Completions**.
The URL is the base *before* `/chat/completions`. Other protocols, the Hub's
Responses SDK options, provider subscription logins and automatic fallback are
not implemented here. HTTPS is required except literal loopback IPs for local
development; URL credentials, queries, fragments and redirects are rejected.

```sh
llame models
llame run "Explain the trade-offs in this design"
printf '%s\n' 'Answer this prompt' | llame run -
llame --model private-endpoint --json run "Return a short answer"
llame
```

With no command, a TTY opens the conversational prompt; piped stdin performs one
turn. `/new`, `/model ID`, `/history`, `/help` and `/exit` are handled locally.
`--chat UUID` continues a recorded conversation across processes. Chat and Run
IDs are printed on stderr and included in JSONL Run events.

## Workspace execution and approvals

Without enabled MCP servers, local mode is text-only by default. To advertise the startup directory as an
explicitly authorized **native** Workspace:

```sh
cd /path/to/project
llame --native run "Inspect this project and propose a small fix"
```

`--cwd /absolute/project` selects the startup directory explicitly. There is no
home-directory discovery or silent switch from sandbox to native execution.
The model must call `workspace_enter` before using files, processes or skills.
Workspace entry loads a bounded, source-attributed `AGENTS.md`, when present.
Neither it nor skill instructions can grant permissions.

Native means **OS-user authority, not a sandbox**. Relative file tools reject
traversal, symlinks, hardlinks, sensitive names and the CLI's state/configuration
paths. These checks do not constrain an approved executable: that program has
the user's OS privileges, can use the network, and can access other host paths.
Review the exact executable and arguments before approving. Repository content
and tool results remain untrusted model input, not operator authorization.

Read/list operations are bounded. A write requires the exact whole-file SHA-256
from a prior read, or `absent` for creation. Each proposed native edit and each native process
requires a separate terminal approval; the default is **No**. Stale edits fail
rather than overwriting a concurrent change. For native tools there is no `--yes`, approve-all,
script/hook execution or prompt-derived permission mode. Piped input cannot
approve, including when its text happens to say `yes`.

Processes get only a minimal environment, not the CLI's model/session secrets.
They have a 30-second deadline, 16 KB combined output cap and POSIX process-group
cleanup. This is best-effort lifecycle control, not hostile-process containment;
a deliberately detached process can escape a process group. Native process
execution refuses Windows without POSIX groups; use WSL. Other platforms and
Windows ACL behavior still need platform-specific validation.

`.agents/skills/<name>/SKILL.md` instructions are discoverable through `skills_list`
and loaded on request through `skill_load`, with source and content hash. This
cut recognizes scalar/folded `name` and `description` metadata, not arbitrary
YAML. Unsupported manifests are not installed or executed. Skill scripts, hooks,
marketplace downloads and author-declared trust are never activated.

## Local durability and recovery

```sh
llame chats list
llame chats show CHAT_UUID
llame runs show RUN_UUID
llame runs events RUN_UUID --after 0
llame --chat CHAT_UUID run "Continue from the recorded observations"
llame recover
```

State defaults to `$XDG_DATA_HOME/llame`, falling back to `~/.local/share/llame`.
`--data-dir` or `LLAME_DATA_DIR` selects another **local** directory. SQLite stores
ordered messages, Run snapshots, append-only events and remote replay cursors.
Snapshots bind the model, prompt, advertised tools and bounds. Credentials live
in separate authority-bound files, not SQLite. A `0700` state directory and
`0600` files are required on POSIX. Do not put this state on a shared network
filesystem. Permissions are not encryption; use appropriate disk protection and
Windows account ACLs.

One executor may advance a state directory at a time. Ctrl-C cancels a local Run
and records its outcome; it exits the REPL. A killed process does not keep working.
`recover` removes a lock only after the recorded PID is dead, marks incomplete
Runs `interrupted` and records `outcome_unknown` for outstanding tool calls.
It **never replays a side effect**. Inspect the Workspace before deciding to retry.
A reused PID is treated conservatively as live. Recovery itself uses a lock; if
that process is killed, inspect `recovery.lock` and the owning PID before manual
cleanup, rather than deleting locks indiscriminately.

The loop is bounded by tool steps, model-output size, context bytes and time.
After the step cap it makes one explicitly tool-free final request. Context
admission is a conservative serialized-byte budget, **not exact token counting**;
there is no automatic compaction or silent history dropping. History is refused
above a separate 8 MiB read guard. This release has no automatic retention policy.
Stop the CLI and copy the whole state directory for a backup, including any WAL
files; protect credential files separately. Do not assume copying a live SQLite
main file alone is a consistent backup.

## Remote authentication and execution

Use the **API** origin, not a web-only hostname, and a pre-existing llame account:

```sh
llame remote enable https://api.example.com
llame auth login --email you@example.com
llame auth status
llame models
llame run "Use the node's configured tools"
llame --chat CHAT_UUID run "Continue"
llame runs attach CHAT_UUID
llame runs events RUN_UUID
llame runs receipt RUN_UUID
llame runs cancel RUN_UUID
llame auth logout
```

The password is prompted without echo. `--password-stdin` is available for a
protected pipeline. `auth import --token-stdin` validates an existing llame
session through `/auth/v1/me` before saving it. To avoid a persistent token file,
set both `LLAME_TOKEN` and `LLAME_TOKEN_FOR` (the exact `--remote` authority).
Environment credentials override a saved credential for that authority; they
are never copied into the local credential store.

This is existing **first-party opaque Bearer-session authentication**, not a new
OAuth authorization server, third-party OIDC token exchange, provider login or
Node enrollment. A distributed CLI must not embed an OAuth client secret.
[The auth research](../../docs/research/cli/2026-09-05-authentication-and-harness.md)
explains the future external-browser PKCE flow, headless device grant, OIDC
identity boundary and separate proof-of-key Node enrollment.

Each saved token is bound to its normalized authority and user ID. Requests do
not follow redirects. Logout revokes the current server session before removing
its local file; an already-expired/revoked session is also safely forgotten.
A network/server failure retains the file so revocation can be retried.
A concurrent new login is not deleted by completion of an older logout; the
credential change is reported and the newer file is retained. With an
environment token, remove it from the parent environment yourself after logout.
`auth forget` explicitly removes only the saved local copy and does **not** revoke.
No refresh token or automatic reauthentication is claimed.

Remote mode does not load local provider configuration and rejects native/cwd
options. A POST submits a message once, obtains the existing Run ID and switches
to the durable cursor-based SSE event stream. Reconnects deduplicate observed
sequences. Cursors are keyed by authority, account and Run. An ambiguous POST is
not automatically repeated: inspect the printed chat/submission ID or attach to
the active chat before submitting again. Ctrl-C disconnects the client; the node
keeps executing. Only `runs cancel` requests remote cancellation.

Remote commands expose existing server capabilities only. The supplied node's
read-only policy is not relaxed, and this CLI does not invent a remote approval
endpoint or execute remote tool requests on your laptop.

## Connected tools, episodic recall and Knowledge

A connected Run is an ordinary node-owned Run. Its available `search_conversations`
and `conversation_read`, `knowledge_search` and `knowledge_read`, and node-managed
MCP tools remain governed by that node's ownership, configuration and policy.
Neither a CLI-specific tool bridge nor Personal Realm synchronization is required.
They execute **on the node**, not on your laptop. Their presence is not guaranteed
merely because a connection exists: inspect the exact Run receipt.

```sh
llame chats search "the decision about indexing"
llame knowledge list
llame knowledge list OPAQUE_NEXT_CURSOR
llame knowledge show SPACE_UUID
llame runs tools RUN_UUID
llame run "Search my earlier conversations and Knowledge Spaces for the decision"
```

`chats search` is the existing chat-list search endpoint, not a CLI implementation
of the richer agent recall tool. Knowledge commands list/show metadata; content
reads/search use the assistant's governed tools. `runs tools` projects historical
bound declarations and available/unavailable states without exposing the whole
system prompt. It does not claim current permission or a generic invocation API.
Use `runs receipt` for the full owner-visible receipt.

Standalone MCP and node-managed MCP remain distinct. The CLI never uploads local
MCP configuration/credentials to the node, imports remote tools into local Runs,
or grants a remote assistant access to local files. Replication, offline remote
Knowledge, cross-node execution and an authenticated remote-tool gateway need
separate contracts; Personal Realm is not being smuggled in as a tool transport.

## Standalone MCP tools

Local Runs can use explicitly configured **stdio** and **Streamable HTTP** MCP
servers without `--native`. The native flag grants generic Workspace tools; MCP
is independently configured. Add an `mcp` map to your user configuration:

```json
{
  "mcp": {
    "notes": {
      "enabled": true,
      "transport": "http",
      "url": "https://notes.example.com/mcp",
      "headers": { "Authorization": "Bearer {env:NOTES_API_TOKEN}" },
      "allowTools": ["search_notes", "read_note"],
      "autoApprove": [],
      "callTimeoutSeconds": 30
    },
    "localdocs": {
      "enabled": false,
      "transport": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/trusted-server.mjs"],
      "cwd": "/absolute/path/to/documents",
      "env": { "DOCUMENT_TOKEN": "{env:DOCUMENT_TOKEN}" },
      "allowTools": ["read_document"],
      "autoApprove": []
    }
  }
}
```

This is a **fragment**, merged into the existing version-1 file with `models`.
`allowTools` and `autoApprove` contain exact upstream names, not namespaced model
IDs. Omitting `allowTools` admits all valid declarations up to the global cap;
an empty list exposes none. Server IDs are lower-case ASCII, begin with a letter,
are at most 32 characters and cannot contain `__`. Model tool IDs reuse the node's
canonical `mcp__SERVER__TOOL` mapping and collision refusal.

```sh
llame --local mcp list
llame --local mcp enable localdocs
llame --local mcp tools localdocs
llame --local run "Find the note about indexing"
llame --local mcp disable localdocs
```

Listing and enable/disable only inspect/change configuration; no server launches,
no provider credentials resolve. `mcp tools` connects and discovers **now** without
requiring a model. `mcp` commands in effective remote mode fail with instructions
to use `--local` or inspect the node's historical receipt instead.

**Enabling stdio is permission to launch that configured executable** on a local
Run or explicit discovery. Initialization is executable code, before any tool
approval. Only configure trusted programs. They have OS-user authority, not a
sandbox; per-tool approval cannot contain a malicious server. The environment is
minimal (`PATH`, `LANG`, optional `SystemRoot`) plus explicit `env`; no ambient
HOME, node session or model key is inherited. `cwd` defaults to the config
file's directory, not the current repository. Commands/arguments must be literal;
put credential references in `env`, never argv. A child can still read accessible
host files: environment isolation is not OS isolation.

Calls require valid admitted JSON Schema **then individual terminal approval**.
Piped stdin cannot approve. `autoApprove` is an optional, exact-name user grant
for trusted tools; it is empty by default. It must be a subset of `allowTools`
when an allowlist is present. Server `readOnlyHint`/other annotations, model text,
repository skills and retrieved documents cannot set this grant. Do not blindly
mark every installed tool auto-approved.

The host reuses `@workspace/tool-runtime`, extracted from the existing API with
its admission, JSON Schema validators, bounded HTTP/stdio, protocol negotiation,
result handling and tests. There are at most 16 configured servers and 128
admitted model tools. Calls default to 30 seconds (configurable 1–300), within the
Run deadline. Discovery failures, collisions and catalog-limit violations fail before model
submission; individual invalid declarations are refused without granting tools. In-Run disconnects
never reconnect or replay actions; uncertain side effects remain uncertain.
Connections close after completion/failure/cancellation. Approval decisions,
results and the admitted catalog are inspectable in local Run evidence. Local
availability uses `llame.cli.tool-availability.v1`, not the node's hashed receipt
schema; remote receipts are projected unchanged. Receipts describe initial
availability, not a live authorization check.

Compatibility is deliberately the repository's pinned client: negotiated
`2025-03-26`, `2025-06-18`, or `2025-11-25`. This is not a claim of support for every
current/future MCP revision. Explicit draft-07, 2019-09 and 2020-12 JSON Schemas
use the existing validator; absent `$schema` retains its draft-07 behavior.

Not implemented here: MCP OAuth discovery/browser login/token refresh, legacy
HTTP+SSE fallback, resources/prompts as standalone CLI operations, server-requested
sampling/elicitation, marketplace installation or automatic project `.mcp.json`
loading. HTTP credentials use explicit header references, independent of llame
node login. A provider that requires MCP OAuth cannot be made to work merely by
running `llame auth login`.

## Output and verification

`--json` emits one JSON value per stdout line. Run output is a stream of events,
not one JSON document. Diagnostics and approval prompts go to stderr. Provider
and terminal control text is sanitized; structured secrets are redacted before
JSON encoding and split streaming secrets are withheld until safely resolved.
A final `client.text_flush` can carry a buffered remote text tail; consume
`model.delta` and this event for machine-rendered text. Do not treat a printed
partial answer as a successful Run: require its terminal event and exit status.

Exit statuses are 0 for success, 1 for validation/protocol/action failure,
124 for a local Run deadline, and 130 for interruption. A denied tool is an
observation; the overall Run may still complete with a truthful explanation.

```sh
pnpm exec turbo run test --filter=cli --concurrency=1
pnpm exec turbo run typecheck --filter=cli --concurrency=1
pnpm exec turbo run test:coverage --filter=@workspace/runtime-safety --filter=@workspace/tool-runtime --concurrency=1
pnpm --filter @workspace/runtime-safety test:mutation
pnpm --filter @workspace/tool-runtime test:mutation
```

The distribution suite currently targets Linux/WSL and needs util-linux `script`
for its real-PTY regression. A missing PTY utility fails instead of skipping.
The CLI distribution tests launch compiled code against real loopback HTTP
fixtures, SQLite, files and child processes. Remote wire fixtures are checked
against the repository's emitted OpenAPI; they are **not** a live deployed-node
or billable-provider acceptance test. Existing moved shared-helper unit tests
remain Vitest tests and retain coverage/mutation gates.

The normal `test` command includes `tests/integration/mcp.test.mjs`, which uses
real SDK transports and must not skip when dependencies are missing. `test:core`
is the explicitly narrower dependency-light suite; it includes an injected MCP
connection-port/model-loop test, not proof of the production SDK wire path.
`test:mcp` runs the wire suite alone after builds. See the checked-in
[round-two verification record](../../docs/research/cli/2026-09-05-round-two-verification.md)
for what was actually executed in the implementation environment, and the
[connection/MCP decisions](../../docs/research/cli/2026-09-05-persistent-connection-and-mcp.md)
for sources and deferred boundaries.
