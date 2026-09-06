# node-ipc

## Purpose

The private IPC capability connects a trusted local Surface to one
single-owner Personal Node. It defines the version-2 JSON-lines transport,
the request surface, channel-bound approvals, and the lifetime of requests and
Runs. It is not hosted HTTP, MCP, a public listener, or a synchronization
protocol.

## Requirements

### Requirement: Private IPC negotiates version 2 before domain methods

The private channel SHALL require one successful `core.hello` request with
`{version: 2}` before any other request. The Node SHALL reject another hello on
the same channel, incompatible versions, unknown envelope or method fields,
identity fields supplied by the caller, and methods outside this capability.
An incompatible daemon SHALL fail explicitly; the client SHALL NOT silently
fall back to another executor or protocol version.

The version-2 request surface SHALL include `core.hello`, `core.describe`,
`core.status`, and same-channel `core.cancel`; realm model, Chat and Knowledge
operations; execution Run admission, inspection, replay and cancellation; and
the explicit `admin.mcp.discover`, `admin.search.rebuild`, and `admin.recover`
operations. `execution.output` and `execution.approval.requested` are server
notifications, not caller-selected methods. No private admin or execution
method SHALL be forwarded through the shared hosted owner-access endpoint.

Private result methods SHALL project explicit egress DTOs. Knowledge creation
and lookup SHALL return resource identity and display metadata without a
managed directory. Run inspection and cancellation SHALL preserve logical
placement metadata without returning a native Workspace root or another
resolved host path.

#### Scenario: A domain request precedes negotiation

- **WHEN** a client sends a domain request before a successful `core.hello`
- **THEN** the Node returns a handshake error
- **AND** it does not inspect state, execute a model, or perform an admin action

#### Scenario: A client connects to an older daemon

- **WHEN** `core.hello` supplies a version other than `2`
- **THEN** the Node returns an explicit protocol-version error
- **AND** it does not downgrade, spawn a competing executor, or execute the request

#### Scenario: A result contains internal placement details

- **WHEN** a client creates or reads a Knowledge Space or inspects/cancels a Run
- **THEN** the response contains no managed directory or native Workspace root
- **AND** the response retains only the declared logical resource and placement fields

### Requirement: JSON-lines frames and channel resources are bounded

Client requests SHALL be one UTF-8 JSON-RPC 2.0 object per newline-delimited
frame, with a nonempty string request ID. Batches and caller notifications
SHALL be rejected. The parser SHALL accept UTF-8 split across input chunks and
SHALL discard an incomplete final frame when the input closes. A request frame
SHALL be at most 1 MiB; a response or queued output SHALL be at most 12 MiB;
one channel SHALL have at most 16 pending requests and 4,096 accepted request
IDs; and the private socket service SHALL cap active connections at 16.

Request IDs SHALL be unique within one channel. A duplicate SHALL produce an
error without replaying the operation. There is no cross-channel idempotency
key. A slow or over-limit observer MAY be disconnected; durable Run events
remain available for a later inspection channel. Protocol errors SHALL expose
stable codes and safe messages, never raw SDK exceptions, credentials, or host
paths.

#### Scenario: A frame is split inside a multibyte character

- **WHEN** a valid JSON frame arrives in chunks that split a UTF-8 character
- **THEN** the Node reconstructs and processes the same frame
- **AND** it does not decode replacement characters into request data

#### Scenario: A frame exceeds its bound

- **WHEN** a request or response exceeds its declared byte limit
- **THEN** the Node returns or records a protocol-limit failure and closes the affected channel as required
- **AND** it does not parse, execute, or queue the over-limit payload

#### Scenario: An incomplete request reaches EOF

- **WHEN** a temporary channel closes after receiving a JSON object without its terminating newline
- **THEN** the Node does not execute that object
- **AND** it closes the temporary request context

### Requirement: Approval decisions are bound to the initiating channel

The Node SHALL generate each approval ID and bind it to the initiating request
and channel. An approval request SHALL identify its request and approval IDs
and carry the redacted Surface prompt. Only that channel SHALL be able to submit
one boolean decision through `execution.approval.decide`; another channel,
replayed ID, arbitrary string, model text, or retrieved content SHALL not grant
the action. A decision SHALL be single-use.

Native writes and processes SHALL require their individual Surface-mediated
approval. MCP configuration grants remain a separate policy path. Decision
receipts SHALL use Node-generated channel identity, local-owner principal,
transport and prompt hash; caller input SHALL not supply that provenance.

#### Scenario: Another channel reuses an approval ID

- **WHEN** an observer submits an approval ID created on another channel
- **THEN** the Node rejects it as unknown on that channel
- **AND** no side effect is authorized

#### Scenario: An approval is replayed after a decision

- **WHEN** the initiating channel submits a second decision for the same approval
- **THEN** the Node rejects the replay
- **AND** the first decision remains the only authorization outcome

#### Scenario: The Surface disconnects while approval is pending

- **WHEN** the channel carrying a pending Surface approval closes
- **THEN** the pending decision resolves to denial
- **AND** a later observer cannot take over the approval

### Requirement: Cancellation, disconnection and executor recovery are distinct

`core.cancel` SHALL cancel only a request on its own channel. An explicit
`execution.runs.cancel` SHALL request cancellation of the addressed active Run
on the contacted Node and SHALL return the current durable Run state. A
temporary stdio channel SHALL cancel its in-flight request on EOF. A persistent
Node SHALL allow an admitted Run to continue after Surface loss, while denying
pending and future Surface approvals; a later channel MAY inspect, replay or
explicitly cancel that Run.

Stopping the Node SHALL cancel active work. Executor death or an uncertain side
effect SHALL require explicit recovery and inspection; the Node SHALL NOT
automatically retry, replay a prompt, or repeat a tool side effect merely
because a Surface or executor disappeared.

#### Scenario: A persistent Surface disconnects during inference

- **WHEN** a persistent channel closes without an explicit Run cancellation
- **THEN** the Node keeps the admitted Run and its durable event log
- **AND** it does not resubmit the prompt or leave a Surface approval waiting

#### Scenario: A later Surface cancels an active Run

- **WHEN** a later channel calls `execution.runs.cancel` for an active Run
- **THEN** the Node aborts that Run and returns its current durable state
- **AND** it does not start a replacement Run

#### Scenario: The executor dies after an uncertain side effect

- **WHEN** recovery finds a stranded running Run
- **THEN** explicit recovery marks the Run interrupted and records an unknown outcome
- **AND** no tool action is replayed automatically
