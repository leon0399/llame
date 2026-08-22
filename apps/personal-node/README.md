# Personal Node experiment

Executable, single-owner local Node for testing Personal Realm reconciliation.
It is deliberately a lightweight sibling of the hosted API, not a local copy of
the NestJS/PostgreSQL/pg-boss stack.

## Run it

The Node takes trusted local configuration from environment variables:

```bash
export LLAME_NODE_ID=desktop
export LLAME_REALM_ID=019d-personal-realm
export LLAME_NODE_DB="$PWD/.local/personal-realm.sqlite"
export LLAME_NODE_TOKEN=replace-with-at-least-16-random-characters
```

Create a non-overwritable Ed25519 writer identity before first use:

```bash
pnpm --filter personal-node start init-identity "$PWD/.local"
export LLAME_WRITER_PRIVATE_KEY="$PWD/.local/writer-identity/private.pem"
export LLAME_TRUSTED_WRITER_KEYS='{"desktop:1":"/absolute/path/public.pem"}'
```

Create a separate transport identity for enrolling this Node with peers. Writer
keys authenticate immutable history; node keys prove the runtime being linked,
so unlinking a Node does not invalidate historical events:

```bash
pnpm --filter personal-node start init-node-identity "$PWD/.local"
export LLAME_NODE_PRIVATE_KEY="$PWD/.local/node-identity/private.pem"
export LLAME_NODE_SCOPES='["realm.sync"]'
```

The trusted-writer map is `writerStreamId:writerEpoch` to public-key file, not
public key content. Historical epoch keys remain configured so old events stay
verifiable after rotation. Every participating Node must configure the same
authorized writer epochs.

Start its authenticated loopback API:

```bash
pnpm --filter personal-node start serve
```

Append a root message while offline (`-` means no parent):

```bash
pnpm --filter personal-node start append chat-id - "First local message"
```

Reconcile in both directions with another Node:

```bash
export LLAME_PEER_TOKEN=the-peer-node-token
pnpm --filter personal-node start sync https://peer.example.test
```

Enrollment scopes are explicit and independently enforced:

- `realm.sync` — Realm frontier, Chat branches, and signed/unsigned sync;
- `run.observe` — Run and Workspace recovery snapshots;
- `run.steer` — steering and cancellation submission;
- `run.execute` — executor event publication and command polling; and
- `run.control` — Run creation, authority transfer, and Workspace recovery
  decisions.

Omitting `LLAME_NODE_SCOPES` defaults to `realm.sync`. A central personal Realm
node that proxies user control can receive `run.observe`, `run.steer`, and
`run.control` without receiving the remote Node's owner credential or executor
authority.

Instead of distributing the peer's owner-control token, enroll once and persist
a revocable credential. `LLAME_PEER_TOKEN` authorizes only the bootstrap request;
the issued credential is never printed and the destination must not already
exist:

```bash
export LLAME_PEER_TOKEN=the-peer-owner-control-token
export LLAME_PEER_CREDENTIAL_PATH="$PWD/.local/peers/home.credential"
pnpm --filter personal-node start enroll https://peer.example.test
unset LLAME_PEER_TOKEN
pnpm --filter personal-node start sync https://peer.example.test
```

Add `LLAME_SYNC_MODE=signed` to exchange only signed envelopes through the
separate signed-sync capability. Signed local appends are enabled when
`LLAME_WRITER_PRIVATE_KEY` is configured. Without those settings the experiment
uses its explicit unsigned compatibility path.

All writers in a Realm must currently be pre-authorized with the same epoch map:

```bash
export LLAME_WRITER_EPOCHS='{"desktop":1,"phone":1}'
```

Plain HTTP peers and listeners are restricted to loopback. Use HTTPS or expose a
loopback listener through a secure authenticated tunnel. The bearer token is
never printed by the process.

## Protocol slice

The authenticated API exposes:

- `GET /v1/capabilities`
- `GET /v1/realm/frontier`
- `POST /v1/sync/export`
- `POST /v1/sync/apply`
- `POST /v1/signed-sync/export`
- `POST /v1/signed-sync/apply`
- `GET /v1/chats/:chatId/branches`
- `POST /v1/enrollment/challenges`
- `POST /v1/enrollment/complete`
- `DELETE /v1/enrollments/:nodeId`
- `POST /v1/runs`
- `GET /v1/runs/:runId/control?after=:eventCursor`
- `POST /v1/runs/:runId/events`
- `POST /v1/runs/:runId/commands`
- `GET /v1/runs/:runId/commands?after=:commandCursor`
- `POST /v1/runs/:runId/authority`
- `POST /v1/runs/:runId/workspace`
- `GET /v1/runs/:runId/workspace`
- `POST /v1/runs/:runId/workspace/unavailable`
- `POST /v1/runs/:runId/workspace/recovered`
- `POST /v1/runs/:runId/workspace/choice`

Enrollment control requires the locally configured owner bearer. A Realm-bound,
single-use challenge proves possession of a separate Ed25519 node key. The Node
stores only a digest of the issued bearer credential; enrolled credentials can
use data-plane routes but cannot enroll or revoke Nodes. Explicit revocation
immediately denies later requests while retaining the historical node record.
The single-owner database intentionally contains no `user_id`. Scope selection,
enrollment, and revocation require the owner credential; possessing one scoped
node credential cannot mint or widen another.

Run control persists only semantic state: current status, published assistant
output, authority transfers, and steering/cancellation commands. It does not copy
harness frames, queue jobs, model-provider buffers, or process state. A global
event cursor supports reconnect and current-state recovery. Each handoff,
fallback, or recovery increments `authorityEpoch`; writes from the prior executor
then fail closed. Commands target one epoch, so a replacement executor never
receives steering intended for the environment it replaced. Run creation and
authority transfer require owner control or an explicit `run.control` grant.
Enrolled Nodes may observe and steer only with their respective scopes, while
only the current executor with `run.execute` may poll commands or publish events
under its derived node identity.

A Run may also hold sticky Workspace affinity with an `ask`, `wait`, `fallback`,
or `exit` unavailability policy. `wait` retains the existing binding and
authority. `fallback` is legal only when egress policy allows the continuation
executor; it atomically transfers Run authority, marks the Workspace temporarily
detached, and automatically restores both binding and authority when the
preferred executor returns. `exit` detaches permanently and later availability
only produces a semantic notification. `ask` returns the legal choices for the
current context. Workspace availability, binding changes, blocked fallback, and
decision requests are structured effects suitable for both UI state and model
reminders—never implicit rerouting. Workspace transitions and their Run authority
events commit in one SQLite transaction. Recovery-control writes require owner
authorization or an explicit `run.control` delegation; bare node identity is not
user authority.

A reconciliation operation pulls peer batches beyond the local frontier, pushes
local batches beyond the peer frontier, and returns both frontier receipts. It
runs up to three immediate rounds when either side advances during the operation.
Persistent churn can still yield `partial`; rerunning safely continues from the
durable frontiers.

If a peer disconnects after receiving an apply request, the result is initially
unknown. The client retries the idempotent batches and reports the number of
recovered ambiguities. If all bounded recovery attempts fail, the CLI exits with
a structured `outcome_unknown` error containing the durable local frontier.

## Deliberate limits

This is evidence, not a shipped federation protocol. It has explicit Ed25519
writer identities, signed event forwarding, and explicit node enrollment and
revocation. Enrollment credentials remain bearer tokens; there is no automated
key rotation, cross-language canonical event standard, encrypted payloads,
snapshots, compaction, Workspace execution, live Run proxying, OAuth bootstrap,
or hosted PostgreSQL adapter. The Run-control API does not yet tunnel to an
external harness, proxy an upstream Node, or preserve raw live streaming deltas.
Node 22 also marks its built-in SQLite API
experimental. The database, private keys, credentials, and SQLite sidecars are
forced to owner-only permissions, but event content is not encrypted at rest.
