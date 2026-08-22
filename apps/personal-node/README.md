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
writer identities and signed event forwarding, but no enrollment, automated key
rotation/revocation, cross-language canonical event standard, encrypted payloads,
snapshots, compaction, Workspace execution, live Run proxying, or hosted
PostgreSQL adapter. Node 22 also marks its built-in SQLite API experimental. The
database, private key, and SQLite sidecars are forced to owner-only permissions,
but event content is not encrypted at rest.
