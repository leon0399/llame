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

Run the same Run-control API shape as a local tunnel to a remote Node:

```bash
export LLAME_NODE_TOKEN=local-phone-facing-secret
export LLAME_PEER_CREDENTIAL_PATH="$PWD/.local/peers/worker.credential"
export LLAME_PROXY_CACHE_DB="$PWD/.local/run-proxy-cache.sqlite"
pnpm --filter personal-node start proxy https://worker.example.test
```

The upstream credential should contain only the `run.observe`, `run.steer`, and
`run.control` scopes the proxy needs. The proxy authenticates the local caller,
substitutes its scoped upstream credential, and never forwards the caller's
credential. It forwards the common Run-control paths but omits executor event
publication and command polling. It stores no remote queue or Run state: after a
proxy restart the caller resumes from its event cursor against the executor's
durable current state. Upstream disconnect during a mutation returns
`outcome_unknown`; an observation disconnect reports unavailability plus the
explicitly stale last-known semantic response when the optional owner-only cache
has one. The cache contains no credentials, raw harness frames, or executor
internals and is never promoted to authority.

To keep one local Node API while several configured Nodes can own different
Runs, use the routed proxy. Its manifest names trusted peers and points at their
owner-only enrolled credential files; origins can never come from an API caller:

```json
{
  "version": 1,
  "peers": [
    {
      "peerId": "workstation",
      "origin": "https://workstation.example.test",
      "credentialPath": "workstation.credential"
    },
    {
      "peerId": "laptop",
      "origin": "https://laptop.example.test",
      "credentialPath": "laptop.credential"
    }
  ]
}
```

```bash
chmod 600 .local/peers/*.credential
export LLAME_NODE_TOKEN=local-phone-facing-secret
export LLAME_PROXY_ROUTES_DB="$PWD/.local/run-routes.sqlite"
export LLAME_PROXY_CACHE_DB="$PWD/.local/run-proxy-cache.sqlite"
pnpm --filter personal-node start proxy-router "$PWD/.local/peers/peers.json"
```

Before creating or controlling a Run, pin its UUID to a configured peer through
the owner-authenticated local endpoint:

```bash
curl -X PUT http://127.0.0.1:4370/v1/proxy/routes/run-uuid \
  -H "Authorization: Bearer $LLAME_NODE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"peerId":"workstation"}'
```

The binding is idempotent. A raw administrative move requires
`{"peerId":"laptop","expectedRouteEpoch":1}`; a stale route epoch is rejected.
The safer path first proves that both configured peers expose the same Run,
Realm, authority epoch, executor, status, and event prefix:

```bash
curl -X POST \
  http://127.0.0.1:4370/v1/proxy/routes/run-uuid/verified-rebind \
  -H "Authorization: Bearer $LLAME_NODE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetPeerId":"laptop","expectedRouteEpoch":1}'
```

Verification does not replicate the Run or transfer executor authority; those
must happen first. It prevents the local route from committing when the target
is absent, stale, divergent, or when the route changed concurrently. The route
database stores only Run UUID, peer ID, and epoch—not credentials. Removing a
configured peer leaves its Runs visibly unavailable; the router does not
silently choose another executor. Cache keys include peer and route epoch, so
observations from before an explicit rebind cannot masquerade as state from the
new peer.

`GET /v1/proxy/peers` probes the configured peers' authenticated capability
documents and returns only peer IDs, availability, and a narrow validated
capability shape. It omits origins and credentials. This is an observation for
UI recovery choices, not a health lease: availability can change immediately
after the response. Routed proxy failures similarly include only the safe peer
ID and route epoch, allowing a client to connect the failure to the durable
route without learning transport or credential configuration.

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

Run creation, semantic executor events, steering commands, and authority
transfers can use those same initial and incremental ChangeBatch exchanges.
They are projected from the Realm journal after restart; there is no separate
Run-import protocol. These authority-bearing operations are rejected on the
unsigned compatibility path. A valid writer signature is necessary but still
insufficient. Configure explicit operation grants, with `run.execute` bound to
the executor node IDs that writer may represent:

```bash
export LLAME_RUN_CONTROL_WRITER_GRANTS='{
  "workstation-writer": {
    "scopes": ["run.execute"],
    "executorNodeIds": ["node-workstation"]
  },
  "personal-controller": {
    "scopes": ["run.steer", "run.control"]
  }
}'
```

Missing grants fail closed. An ordinary Chat or knowledge writer cannot create a
Run, publish executor state, submit commands, or move authority.
The current live Run-control HTTP endpoints still write their dedicated
prototype store; bridging those live writes into signed Realm batches is not yet
implemented.

The first executable local-author bridge creates a Run under an explicitly
separate writer identity and prints only its batch reference and frontier:

```bash
export LLAME_WRITER_STREAM_ID=personal-controller
export LLAME_WRITER_PRIVATE_KEY="$PWD/.local/controller/private.pem"
pnpm --filter personal-node start run-create run-uuid node-workstation
pnpm --filter personal-node start run-status run-uuid running
pnpm --filter personal-node start run-steer run-uuid "Run focused tests"
pnpm --filter personal-node start run-transfer run-uuid node-laptop handoff
```

The reusable `SignedRealmRunAuthor` adapter also authors executor events,
commands, and authority transfers. A future harness adapter should use its own
writer key locally and sync the signed result; the upstream Node must never sign
an enrolled executor's event under the upstream Node's identity.

The daemon can expose the same Run-control API over the signed journal instead
of the legacy prototype store:

```bash
export LLAME_RUN_CONTROL_MODE=journal
export LLAME_WRITER_STREAM_ID=personal-controller
export LLAME_WRITER_PRIVATE_KEY="$PWD/.local/controller/private.pem"
pnpm --filter personal-node start serve
```

Mirrors that only observe replicated Runs do not need a private writer key:

```bash
export LLAME_RUN_CONTROL_MODE=journal-read-only
pnpm --filter personal-node start serve
```

Both journal modes serve observations and command polling from the replicated
projection. Read-only mode rejects local mutations. Read-write mode accepts
mutations only through the owner-local credential and signs them with the
configured writer. An enrolled remote node cannot make this daemon impersonate
it; that node must author locally and use signed Realm sync.
Workspace recovery still uses the legacy prototype store and is therefore not
available for journal-only Runs yet.

A serving node can continuously reconcile its signed Realm journal with one
configured peer:

```bash
export LLAME_SYNC_PEER_ID=home
export LLAME_SYNC_PEER_URL=https://personal.example.test
export LLAME_PEER_CREDENTIAL_PATH="$PWD/.local/peers/home.credential"
export LLAME_SYNC_INTERVAL_MS=5000
pnpm --filter personal-node start serve
```

This runs once immediately and then after each completed attempt, so slow peers
cannot create overlapping reconciliations. The capability document reports the
safe peer ID, `idle | synchronizing | synchronized | degraded`, last confirmed
success, and `outcome_unknown | partial_coverage | unavailable` when degraded.
It does not expose the peer origin, credential, or raw error. Shutdown waits for
an in-flight attempt before closing the Realm database. Continuous mode is
signed-only and requires the trusted writer-key map.

## Manually registered Workspaces

The serving node can advertise only an operator-written Workspace manifest. It
does not scan directories, clone repositories, or accept caller-supplied paths
or policies:

```json
[
  {
    "id": "llame",
    "label": "llame",
    "rootPath": "/srv/workspaces/llame",
    "entryPolicy": "ask",
    "recoveryPolicy": "fallback"
  }
]
```

```bash
export LLAME_WORKSPACE_MANIFEST="$PWD/.local/workspaces.json"
pnpm --filter personal-node start serve
```

For the CLI-launched case, `serve-here` ignores directory discovery and creates
one `current-directory` Workspace from the process working directory:

```bash
cd /path/to/the/project
pnpm --filter personal-node start serve-here
```

That single Workspace is auto-approved because selecting the directory and
launching the process is the user's explicit placement decision. A manifest is
rejected in this mode, so sibling or previously configured Workspaces cannot be
advertised accidentally. The pnpm wrapper preserves its caller's directory
rather than advertising the package directory. No repository is cloned.

`GET /v1/workspaces` exposes only IDs and labels. `EnterWorkspace` maps to
`POST /v1/runs/:runId/workspace/enter`: `auto-approve` creates the Run affinity
immediately, while `ask` returns a one-time request that the owner must approve
through `POST /v1/workspace-entry-requests/:requestId/approve`. The caller
cannot downgrade either entry or recovery policy. When a registry is enabled,
the older direct-affinity endpoint is disabled to prevent bypassing this policy
boundary. Pending requests survive daemon restarts in the node database, and a
failed affinity write does not consume the one-time approval.
Calling `EnterWorkspace` again for a Run already attached to that Workspace
returns `already-entered` from durable affinity state and does not ask again.
Each pending prompt is fenced to the executor node and Run authority epoch that
existed when it was shown. If authority moves before approval, the stale prompt
is invalidated and the caller must request entry again against current state.

Only the enrolled node that currently holds Run execution authority can resolve
`GET /v1/runs/:runId/workspace/binding` to the configured local `rootPath`.
The model/controller and prior executors cannot read it. This gives a local
harness the input needed to change its own working directory or bind the path
into its sandbox, but the node does not yet perform that mount or create a Git
worktree; the capability therefore reports `policy-gated-binding` rather than
claiming a managed sandbox. Resolution checks that the configured root is still
a directory and returns `workspace_unavailable` instead of handing an executor
a stale path; the existing recovery policy decides what happens next.

`POST /v1/runs/:runId/workspace/exit` is the explicit `ExitWorkspace` semantic:
it permanently detaches the binding while keeping the Run on its current
executor and authority epoch. It is idempotent and persists as a distinct audit
event; it is not disguised as node failure or fallback.

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
- `GET /v1/workspaces`
- `POST /v1/runs/:runId/workspace/enter`
- `POST /v1/runs/:runId/workspace/exit`
- `POST /v1/workspace-entry-requests/:requestId/approve`
- `GET /v1/runs/:runId/workspace/binding`
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
snapshots, compaction, Workspace execution, OAuth bootstrap, or hosted PostgreSQL
adapter. The Run-control proxy does not yet tunnel a native external harness
stream, preserve raw live deltas, discover peers, select a peer automatically,
reconcile a mutation automatically after `outcome_unknown`, author signed Realm
batches from the live Run-control API, or atomically coordinate route rebind with
remote Run-authority transfer. Node 22 also marks its built-in SQLite API
experimental. The database, private keys, credentials, and SQLite sidecars are
forced to owner-only permissions, but event content is not encrypted at rest.
