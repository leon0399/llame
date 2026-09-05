# cli

## Purpose

A first-party terminal that is independently useful with user-operated model
inference and local state, and can alternatively act as a thin client of an
existing llame API node. This capability does not imply personal-store mirroring,
Node enrollment, hosted Workspace execution or full Hub feature parity.

## Requirements

### Requirement: Execution authority is explicit

The CLI SHALL select `--local` or `--remote URL` first, then a saved
`remote.enabled: true` and `remote.url`, then standalone. `remote enable [URL]`
and `remote disable` SHALL persist that setting atomically without writing or
resolving credentials into configuration. Login alone SHALL NOT change mode.
Authentication or connectivity failure SHALL NOT trigger local fallback.
Remote mode SHALL parse routing settings without resolving local provider/MCP
secrets, advertise no local Workspace, and forward no local credentials.

#### Scenario: An operator enables a remote and restarts

- **WHEN** the operator runs `remote enable URL` and later starts a fresh CLI
- **THEN** that authority is the default for Runs, models, chats and auth
- **AND** `--local` overrides it for one invocation without changing the setting

#### Scenario: An operator disables the remote

- **WHEN** the operator runs `remote disable`
- **THEN** later invocations select standalone and retain the remote URL/session
- **AND** session revocation remains an explicit `auth logout` operation

#### Scenario: Local grants are attached to remote execution

- **WHEN** the selected remote is combined with `--native` or `--cwd`
- **THEN** the CLI rejects the invocation instead of merging execution authority
- **AND** `--config` may select the file containing remote routing settings

### Requirement: Standalone mode has independent configuration and state

Standalone status and model inspection SHALL work without an account or provider.
Inference SHALL require an explicitly configured user-managed OpenAI-compatible
Chat Completions endpoint and model. The CLI SHALL NOT download models, start a
provider runtime, infer credentials, send telemetry or silently drop context.
Configuration SHALL be strict versioned JSON and reuse existing llame secret
interpolation. Unsupported fields and model selections SHALL fail closed.

#### Scenario: No model is configured

- **WHEN** an operator starts inference with no selected configured model
- **THEN** the CLI returns a configuration error without calling a provider
- **AND** local identity/status remain available without a Hub

### Requirement: Local Run evidence survives process boundaries

A local SQLite store SHALL retain ordered messages, append-only Run events and
immutable effective-context snapshots. Snapshots SHALL bind model selection,
current tool declarations, effective system instructions, Workspace placement
and execution bounds without provider credentials. A single executor SHALL
advance a state directory at a time. Completed observations SHALL be committed
before their corresponding events are published to the terminal.

#### Scenario: Conversation continuation

- **WHEN** a new process runs with an existing `--chat` identifier
- **THEN** model input includes the recorded messages in order
- **AND** the new Run rebinds current model/tool authority explicitly, rather than
  inheriting permissions from old conversation text

#### Scenario: Executor death

- **WHEN** a Run's executor dies before recording its terminal state
- **THEN** explicit dead-PID recovery marks it `interrupted`
- **AND** outstanding calls receive an `outcome_unknown` observation
- **AND** recovery does not repeat a model request or side effect

### Requirement: The local loop is bounded and tool outcomes stay correlated

The runtime SHALL bound model response assembly, tool arguments/results, context
bytes, steps and duration. At the step cap it SHALL make one explicitly tool-free
final request. Invalid arguments, unavailable tools, denials and failures SHALL
produce correlated tool observations. Incomplete model responses SHALL NOT
execute partial tool calls. Context overflow SHALL fail without silent history
omission; byte admission SHALL NOT be represented as exact token accounting.

#### Scenario: A provider drops a stream before finishing a tool call

- **WHEN** the completion has no valid terminal finish marker
- **THEN** the Run fails with partial text retained only as events
- **AND** no partial call executes and no message is automatically resubmitted

### Requirement: Native Workspace placement and side effects require authority

Without `--native`, standalone execution SHALL advertise no file/process tools.
With it, only the startup directory SHALL be offered, and the model SHALL call
`workspace_enter` before file, skill or process use. Read tools SHALL enforce
relative-path, sensitive-path, symlink/hardlink and size restrictions. Native
placement SHALL be disclosed as OS-user authority, not a sandbox.

Every write and process SHALL require a separate terminal approval. Piped input
SHALL NOT approve. Writes SHALL revalidate the expected whole-file hash after
approval and before replacement. Processes SHALL use a minimal environment and
bounded duration/output. POSIX process-group cleanup SHALL NOT be represented as
hostile-process containment; unsupported Windows process execution SHALL fail.

#### Scenario: The file changes while an edit is awaiting approval

- **WHEN** the owner approves the proposed edit after its expected hash is stale
- **THEN** the runtime rejects the write and preserves the new file contents

#### Scenario: Repository text asks the model to bypass permissions

- **WHEN** Workspace or skill text requests a grant or automatic execution
- **THEN** it remains advisory/untrusted model context
- **AND** the runtime's tool availability and per-action approval rules remain
  unchanged

### Requirement: Skills are lazy instruction context, not executable grants

The local CLI SHALL list and explicitly load bounded `.agents/skills/*/SKILL.md`
instructions with source and content hash. Its documented metadata subset SHALL
NOT imply general YAML support. It SHALL NOT run skill scripts/hooks, install
packages, fetch a marketplace, or trust author-declared permissions.

#### Scenario: A skill includes script instructions

- **WHEN** the model loads the skill
- **THEN** loading returns instructions and attribution only
- **AND** any later proposed process still needs independent owner approval

### Requirement: Remote sessions remain authority/account-bound

Remote authentication SHALL reuse the existing `/auth/v1/login`, `/me` and
session revocation API. Tokens SHALL be stored separately from configuration and SQLite, bound to
the exact normalized authority and verified account. Token import SHALL use
stdin; environment credentials SHALL require matching `LLAME_TOKEN_FOR`.
Passwords/tokens SHALL NOT be accepted as command-line option values.

HTTPS SHALL be required except literal loopback development addresses. URL
credentials, query/fragment and redirects SHALL be rejected. POSIX state and
credential files SHALL be owned by the current OS user, with directory mode
0700 and file mode 0600. Auth defaults to `$XDG_DATA_HOME/llame/auth` (or
`~/.local/share/llame/auth`), not a config field. Relative XDG roots SHALL be
ignored. Reads SHALL check opened file identity, size, ownership and link count;
symlinked parents SHALL be refused before creating files. File modes SHALL NOT
be called encryption or protection against processes running as the same user.

#### Scenario: A saved token resolves to another account

- **WHEN** `/auth/v1/me` no longer matches the stored user identity
- **THEN** domain execution fails before any model/Chat request

#### Scenario: Logout cannot contact the server

- **WHEN** session revocation fails due to network/server failure
- **THEN** the CLI reports failure and retains its credential for another attempt
- **AND** only explicit `auth forget` can discard the local copy without claiming
  revocation

#### Scenario: The server session already expired

- **WHEN** revocation returns unauthorized for an expired/revoked token
- **THEN** logout removes the saved credential without requiring successful `/me`

### Requirement: Remote Runs remain server-owned

The CLI SHALL submit a user message once using the existing API contract, obtain
its Run ID, and follow durable SSE events by sequence. It SHALL persist cursors
by authority, account and Run, deduplicate replayed sequences, and use bounded
reconnection. An ambiguous submission SHALL NOT be repeated automatically.
Disconnecting SHALL NOT cancel the server Run; an explicit `runs cancel` SHALL
use the existing cancellation API.

#### Scenario: A stream disconnects after sequence two

- **WHEN** the connection is re-established
- **THEN** the client requests events after its rendered sequence
- **AND** duplicate prior sequences are not rendered again in that client
- **AND** the user message is not resubmitted

### Requirement: Machine output and secrets have explicit boundaries

`--json` SHALL emit JSONL on stdout with diagnostics/prompts on stderr. Protected
configuration values SHALL be redacted before transcript persistence and JSON
encoding, including when a provider splits a secret across streaming deltas.
Terminal control text SHALL not be interpreted as model-authorized terminal
commands. A partial answer SHALL not imply terminal Run success.

### Requirement: Authentication does not claim Node enrollment

A local runtime UUID and a human remote session SHALL NOT be represented as
cryptographic Node enrollment. This capability SHALL NOT claim OAuth/OIDC IdP
exchange, a device authorization endpoint, Node keypair registration, Personal
Realm synchronization, Profile/Knowledge replication, or cross-node execution.
These require separate capability contracts.

### Requirement: Connected Runs retain the node's governed capabilities

Remote execution MUST create ordinary authenticated node Runs, rather than importing
server tools into the local executor. The node MUST continue to resolve tool and
Knowledge ownership/policy. Personal Realm synchronization MUST NOT be a prerequisite
for using remote episodic retrieval, Knowledge tools, or node-managed MCP tools.

#### Scenario: Inspect actual tool availability

- **WHEN** the user invokes `runs tools UUID`
- **THEN** the CLI projects the Run's exact bound declarations and availability receipt
- **AND** unavailable/unobserved states remain distinguishable
- **AND** it identifies this as historical availability, not a live permission grant.

#### Scenario: Browse connected Knowledge and conversations

- **WHEN** the user invokes `knowledge list [CURSOR]`, `knowledge show UUID`, or
  `chats search QUERY` with remote enabled
- **THEN** the CLI uses the existing authenticated, owner-scoped API resources
- **AND** forwards opaque pagination cursors without replacing authorization identity
- **AND** chat-list search is not presented as the richer agent episodic retrieval tool
- **AND** no local mirror, synchronization, or generic remote tool gateway is implied.
