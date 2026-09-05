# First-party CLI: local execution and remote sessions

## Why

The bundled VISION and the 2026-08-21 local-nodes research require an independently
useful CLI, not a terminal that stops working when a Hub disappears. The current
API already provides a separate, authenticated remote execution surface. These
are two explicit execution modes, not automatic failover paths.

## Scope

Implement a TypeScript CLI with local configuration, a single bounded agent loop,
SQLite transcripts and run events, explicit native Workspace access, instruction-
only lazy skills, and a remote client for the existing versioned API. Extract
existing pure runtime safety helpers rather than copying them. Preserve remote
worker ownership, cancellation and event replay. Add executable distribution
checks with local HTTP fixtures and real SQLite; keep existing API tests intact.

Remote login creates a human session, **not Node enrollment**. Local history,
provider keys and Workspace content are never uploaded by authentication or
attachment. No federation, sync, shell daemon, automatic model installation,
third-party OAuth token impersonation or automatic sandbox-to-native downgrade.

## Security decisions

The operator selects local versus remote, model endpoint, and native placement.
The model can request entry into only the startup Workspace. Read tools are
bounded and exclude secret/state paths. Native writes and process execution need
individual human approval; redirected input cannot approve actions. Native is
explicitly OS-user authority, not a filesystem/network sandbox.

A run owns a persisted transcript and event log; an exclusive execution lock
prevents competing local executors. Interrupted actions are never automatically
replayed. A failed stream is not automatically resubmitted as a new user message.

The existing API's opaque, revocable Bearer sessions authenticate the remote
client. Credentials are authority-bound and kept separately from transcripts.
OAuth/OIDC and proof-of-key enrollment are analyzed in the linked research;
unsupported server endpoints are not invented by the client.

## References

- [Bundled vision](../../../VISION.md)
- [Local nodes and Workspaces research](../../../docs/research/product-vision/2026-08-21-local-nodes-workspaces-and-distributed-execution.md)
- [Authentication and harness decisions](../../../docs/research/cli/2026-09-05-authentication-and-harness.md)
