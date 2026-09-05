# Integrate the shared installation, personal Node, and terminal

## Basis

The round-three bundle (`f007c48`) is the implementation base. Its VISION.md,
SPEC.md, and the distributed-execution research are authoritative for this
iteration; the separately attached older June files are not substituted for them.

## Problem

The CLI branches between local JSON-RPC and handwritten hosted REST operations.
The personal runtime is launchable only through a runtime package or CLI command.
Hosted search used by the terminal is not the canonical model recall operation.
Knowledge content reads exist on both Nodes but only the local CLI can call them.
Sharing safety helpers has not established a shared Node contract.

## Decision

Keep two independently owned runtimes and a thin Surface. Share a versioned,
capability-discovered domain protocol and client adapters, not a database,
credential vault, tenant policy, or a least-common-denominator agent loop.
Create an independent personal Node application. Expose an authenticated hosted
Node adapter over existing services. Reuse canonical recall and Knowledge tools
at that adapter; never add generic model-callable RPC/admin/tool execution.
Make Run admission explicit rather than scraping its identity from a UI stream.

The integrated slice is online access to the selected authority. It is not
Personal Realm enrollment, mirroring, foreign mounts, cross-node Workspace
execution, or a declaration that all Node capabilities have equivalent support.
Unsupported methods are advertised as absent and fail before mutation.

## Threats and acceptance

Identity is derived from the existing authenticated session on every hosted
request. A client-supplied principal is an assertion only, never tenant selection.
Cross-owner IDs must remain indistinguishable from missing IDs. Query bodies
cannot contain user IDs, credentials, native grants, filesystem roots or arbitrary
tool IDs. Hosted retrieval obeys the installed tool gate and existing RLS.
Local administration stays on private IPC. Protocol errors never include raw
exceptions or secrets. A lost admission response is uncertain, never retried.

Tests cover common method validation, negative identity and unsupported methods,
canonical hosted adapter wiring, both client transports, independent personal
startup, existing terminal regressions, and preserved messages/receipt semantics.
Full production acceptance requires the repository-pinned dependency closure;
missing transport dependencies must fail rather than silently skip.
