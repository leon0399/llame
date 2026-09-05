# llame CLI

A first-party TypeScript terminal with two explicit modes:

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

Copy the **whole** `standalone` directory, including its two bundled workspace
packages, to another machine. It needs Node but no npm install or database server.
It contains no model, provider configuration or credentials. The CLI is not
published to npm by this change. Node 22's built-in SQLite emits an experimental
warning; it goes to stderr, not JSONL stdout.

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

Local mode is text-only by default. To advertise the startup directory as an
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
from a prior read, or `absent` for creation. Each proposed edit and each process
requires a separate terminal approval; the default is **No**. Stale edits fail
rather than overwriting a concurrent change. There is no `--yes`, approve-all,
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

State defaults to `$XDG_STATE_HOME/llame`, falling back to `~/.local/state/llame`.
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
llame --remote https://api.example auth login --email you@example.com
llame --remote https://api.example auth status
llame --remote https://api.example models
llame --remote https://api.example run "Use the node's configured tools"
llame --remote https://api.example --chat CHAT_UUID run "Continue"
llame --remote https://api.example runs attach CHAT_UUID
llame --remote https://api.example runs events RUN_UUID
llame --remote https://api.example runs receipt RUN_UUID
llame --remote https://api.example runs cancel RUN_UUID
llame --remote https://api.example auth logout
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
A network/server failure retains the file so revocation can be retried. With an
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
pnpm exec turbo run test:coverage --filter=@workspace/runtime-safety --concurrency=1
pnpm --filter @workspace/runtime-safety test:mutation
```

The CLI distribution tests launch compiled code against real loopback HTTP
fixtures, SQLite, files and child processes. Remote wire fixtures are checked
against the repository's emitted OpenAPI; they are **not** a live deployed-node
or billable-provider acceptance test. Existing moved shared-helper unit tests
remain Vitest tests and retain coverage/mutation gates.
