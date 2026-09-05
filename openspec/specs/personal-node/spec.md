# personal-node

## Purpose

A single-owner local Node owns state, inference, native/MCP execution and local
retrieval independently of its terminal Surface. It remains usable without a Hub
account, a network connection when its configured capabilities work offline,
Postgres, Realm enrollment or a user-managed daemon.

## Requirements

### Requirement: Surfaces do not own local execution

Ordinary local CLI commands SHALL use a negotiated private Node channel and
SHALL NOT open SQLite or execute model tools. Without a persistent service, the
CLI SHALL launch the bundled stdio Node automatically. A foreground `node serve`
SHALL expose only a private Unix socket. Hosted remote execution SHALL retain
its existing HTTP/Bearer adapter; missing protocol parity SHALL NOT be fabricated.

#### Scenario: Local use without a Hub

- **WHEN** the owner starts the CLI without a remote or daemon
- **THEN** a temporary local Node handles its state and configured inference
- **AND** no login, Postgres, model download or network listener is introduced

### Requirement: Local authority is fixed outside the model

The Node SHALL derive local-owner authority from its private channel. Its startup
configuration and native Workspace grant SHALL be checked before inference.
Unknown protocol versions/fields SHALL fail closed. An occupied, insecure or
stale local endpoint SHALL NOT cause fallback to another executor. The service
SHALL advertise only implemented modules and SHALL NOT advertise synchronization.

#### Scenario: A client requests a different Workspace

- **WHEN** a native request differs from the server's explicit startup grant
- **THEN** the request fails before inference or tool execution
- **AND** the client cannot grant a different filesystem root through arguments

### Requirement: Approvals and lifetime belong to the execution boundary

Approval IDs SHALL be single-use and bound to the initiating channel. Native
writes/processes SHALL require individual Surface-mediated decisions; the CLI
SHALL reject piped approvals. MCP config grants SHALL retain their separate
semantics. Runtime-generated decision provenance SHALL be logged, not taken from
model input. Disconnection SHALL deny pending/future Surface approvals.

A temporary Node SHALL cancel on input closure. A persistent Node SHALL retain
its Run after terminal disconnection, support bounded ordered replay and explicit
cancellation, and never repeat an uncertain side effect. A dead executor SHALL
require explicit recovery, not automatic retry.

#### Scenario: Another client tries to reuse an approval

- **WHEN** an observer submits an approval ID from another connection
- **THEN** no pending approval is granted and no side effect is authorized
- **AND** an already decided approval cannot be replayed on the original channel

#### Scenario: A terminal dies during persistent inference

- **WHEN** the connection closes without explicit cancellation
- **THEN** the Node can finish and a later client can inspect/replay its events
- **AND** the original prompt is not re-submitted

### Requirement: Local retrieval is source-backed and bounded

The Node SHALL preserve source transcripts, stable message UUIDs and dense
Chat-local source locators when migrating existing state. A rebuildable SQLite
trigram projection SHALL contain only user/assistant visible text. Search SHALL
accept literal multilingual queries of at least three characters, expose coverage
and source coordinates, and SHALL NOT claim embedding or semantic retrieval.
Read-only recall tools SHALL treat historical text as evidence, not instructions.

Provisioned Markdown Knowledge Spaces SHALL use distinct stable UUIDs beneath a
managed private root. Live reads/search SHALL reuse the hosted filesystem adapter
and its path, UTF-8, byte, entry and line bounds. Model Runs SHALL bind exact space
IDs at start; a newly created space SHALL NOT silently expand an active Run's
grant. Missing/failed sources SHALL NOT be represented as complete coverage.

#### Scenario: A note is edited outside llame

- **WHEN** the owner changes a registered Markdown file
- **THEN** subsequent local search/read observes the live file without indexing
- **AND** the source cannot grant tools, native placement or synchronization

#### Scenario: Derived search data is lost

- **WHEN** the owner runs `search rebuild`
- **THEN** the index is rebuilt from stored visible text
- **AND** source bytes, message IDs, Chat-local locators and decisions are unchanged

### Requirement: The Personal Realm remains distinct from a local Node

This cut SHALL NOT claim enrollment, cross-node replication, hosted/local tool
bridging, Profile Space synchronization or a common hosted execution engine.
Local source identity SHALL NOT be presented as cryptographic ownership. Secrets,
configuration, host paths, raw Run events and derived indexes SHALL NOT be
implicitly made portable merely because they live beneath the data directory.
