# node-access

## Purpose

Integrate the shared installation, independently operable personal Node and CLI
through one capability-discovered owner-access subset of the Node protocol.
This is online access to a selected authority, not Personal Realm replication.

## Requirements

### Requirement: Runtime ownership stays separate from surfaces

`apps/node` SHALL be independently launchable without invoking the CLI. The
personal runtime SHALL continue owning SQLite, configuration resolution and
execution. The hosted API SHALL remain the sole owner of its Postgres data and
tenant policy. `apps/cli` SHALL use reusable clients, not import either store or
execute model tools. The independent Node SHALL reuse the existing runtime.

#### Scenario: No account and no daemon

- **WHEN** a local CLI command starts without a server
- **THEN** its client launches the independent Node over private stdio
- **AND** no hosted account, Postgres, TCP listener or model download is required

### Requirement: Capability discovery precedes shared owner reads

Both deployments SHALL implement common core/realm version 1 discovery and the
advertised subset of conversation search/read and Knowledge search/read. Requests
SHALL reject unknown fields, identity injection, unsupported methods, invalid
ranges and host paths. An explicit null SHALL NOT mean an omitted default.
Descriptions SHALL expose differing search strategy and minimum query length.
Results SHALL bind method, authenticated principal, Node kind and identity to
bounded native evidence. Ranking, pagination and source formatting SHALL NOT be
represented as identical between implementations.

#### Scenario: A source is unavailable

- **WHEN** the selected deployment does not advertise a requested method
- **THEN** the client fails without querying another authority or starting a model

### Requirement: Hosted access uses the real owner and existing read gates

The HTTP adapter SHALL derive its subject from the existing session guard, check
any expected-principal assertion and pass only the trusted subject to its port.
It SHALL call the existing canonical operations with exact code-owned allowlist
and read-only classification checks, not create a generic tool/admin gateway.
Knowledge and conversation resources SHALL remain owner-scoped under existing
resolvers/repositories and RLS. Cross-owner IDs SHALL remain indistinguishable
from missing resources. Raw exceptions SHALL NOT cross the protocol boundary.

#### Scenario: A client substitutes an owner

- **WHEN** parameters include a user ID or a header asserts a different subject
- **THEN** no query or Run is admitted using that identity

### Requirement: Run admission is independent from its observer

Hosted `POST /api/v1/runs` SHALL reuse the existing message admission transaction
and dispatcher and return `202` with Run, Chat and Message identities after
successful dispatch. The existing web stream route SHALL call that same
admission operation before attaching its UI bridge. The CLI SHALL verify returned
identities, then follow existing cursor-based events. A lost response SHALL NOT
cause automatic retry or a second submission through a compatibility endpoint.

#### Scenario: The admission response is lost

- **WHEN** a message may have been accepted but its response is incomplete
- **THEN** the client reports an uncertain outcome and preserves inspection IDs
- **AND** no message, tool call or Run is automatically replayed

### Requirement: Version and reconciliation boundaries are truthful

Private IPC SHALL negotiate version 2 because former query names/envelopes
changed. Shared core/realm access SHALL independently negotiate version 1.
Older personal daemons SHALL fail explicitly without silent executor fallback.
Neither human login nor a runtime UUID SHALL claim cryptographic enrollment.
Discovery SHALL explicitly report that synchronization and enrollment are absent.
No credentials, host paths, source records or derived indexes SHALL be copied
between deployments by these methods.
