# Personal Node Protocol Slice, As Built

Recorded 2026-08-22, extracted 2026-08-24. Active, noncanonical research adjacent to the
[personal Node experiment findings](2026-08-22-personal-node-experiment-findings.md) and the
[local Sandbox confinement contract](2026-08-22-local-sandbox-confinement-contract.md).

The findings note records what the prototype broke; the confinement note records the isolation
posture it proved. This one records **what the thing actually looked like** — the endpoint surface,
the scope and status vocabularies, and the policy semantics that were only ever written down in
`apps/personal-node/README.md`, a 511-line document that dies with the closed branch.

These are as-built shapes from an unshipped experiment, not proposed interfaces. They are recorded
because a future OpenSpec capability spec for enrollment, Run control, or Workspace placement would
otherwise start from a blank page, and because the vocabularies below are the concrete instantiation
of language VISION already uses abstractly.

## 1. Status

Noncanonical. SPEC.md §1.1 holds: no Node enrollment, Personal Realm mirroring, remote Workspace
registry, or cross-node execution placement ships. Archived at
`experiment/personal-node-2026-08-22` (`25a4fd99`).

## 2. Enrollment scopes

Five scopes, independently enforced, defaulting to `realm.sync` alone. **(verified.)**

| Scope         | Authorizes                                                     |
| ------------- | -------------------------------------------------------------- |
| `realm.sync`  | Realm frontier, Chat branches, signed and unsigned sync        |
| `run.observe` | Run and Workspace recovery snapshots                           |
| `run.steer`   | Steering and cancellation submission                           |
| `run.execute` | Executor event publication and command polling                 |
| `run.control` | Run creation, authority transfer, Workspace recovery decisions |

The composition is the point: a central personal Realm node that proxies user control receives
`run.observe`, `run.steer`, and `run.control` **without** the remote Node's owner credential and
**without** executor authority. Control and execution are separable, and neither implies the other.

Enrollment mechanics worth keeping:

- A Realm-bound, **single-use challenge** proves possession of a separate Ed25519 node key.
- The Node stores **only a digest of the issued credential**, never the credential. **(verified —
  `sha256`, persisted as `credential_digest`.)**
- Enrolled credentials reach data-plane routes but **cannot enroll or revoke** other nodes;
  possessing one scoped credential can neither mint nor widen another.
- Revocation denies immediately while **retaining the historical node record**.
- The single-owner database deliberately contains **no `user_id`**. Ownership is the installation.
- `LLAME_PEER_TOKEN` authorizes only the bootstrap request; the issued credential is never printed,
  and the destination file must not already exist.

## 3. Writer key configuration

Trusted writers are configured as a map from **`writerStreamId:writerEpoch`** to a public-key _file
path_, not to key content. Historical epochs stay configured so events signed before a rotation
remain verifiable, and every participating Node must configure the same authorized writer epochs.

Grants are separate from trust, and fail closed when absent. `run.execute` additionally names the
executor node IDs that writer may represent:

```json
{
  "workstation-writer": {
    "scopes": ["run.execute"],
    "executorNodeIds": ["node-workstation"]
  },
  "personal-controller": { "scopes": ["run.steer", "run.control"] }
}
```

An ordinary Chat or knowledge writer cannot create a Run, publish executor state, submit commands,
or move authority. A valid signature is necessary and never sufficient.

## 4. Workspace unavailability policy

VISION and ROADMAP already speak of `ask | wait | fallback | exit` recovery. This is what those four
words meant when implemented. **(verified — the recovery policy is exactly that enum; the _action_
enum is the same set minus `ask`, since `ask` is a request for a decision, not a decision.)**

| Policy     | Semantics                                                                                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wait`     | Retains the existing binding and the current authority. Nothing moves.                                                                                                                                                                       |
| `fallback` | Legal **only when egress policy allows the continuation executor**. Atomically transfers Run authority, marks the Workspace temporarily detached, and automatically restores both binding and authority when the preferred executor returns. |
| `exit`     | Detaches permanently. Later availability produces only a semantic notification, never a silent re-entry.                                                                                                                                     |
| `ask`      | Returns the legal choices for the current context, so the owner picks among what is actually possible.                                                                                                                                       |

Workspace availability, binding changes, blocked fallback, and decision requests are **structured
effects** suitable for both UI state and model reminders — never implicit rerouting. Workspace
transitions and their Run authority events commit in **one** SQLite transaction.

Entry policy is separate and operator-written, in a manifest the node never derives:

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

- `GET /v1/workspaces` exposes **only IDs and labels** — never `rootPath`.
- `auto-approve` creates affinity immediately; `ask` returns a one-time request the owner approves
  explicitly. **The caller cannot downgrade either policy.**
- Enabling the registry **disables** the older direct-affinity endpoint, so the policy boundary
  cannot be bypassed by the path that predates it.
- Re-entering a Workspace a Run already holds returns `already-entered` from durable affinity.
- `serve-here` advertises exactly one `current-directory` Workspace, auto-approved because launching
  the process there _is_ the placement decision, and **rejects a manifest** so sibling directories
  cannot be advertised by accident.

## 5. Sync status vocabulary

Continuous reconciliation reports `idle | synchronizing | synchronized | degraded`, and when
degraded, a reason of `outcome_unknown | partial_coverage | unavailable`. **(verified.)**

It exposes the safe peer ID and the last confirmed success. It does **not** expose the peer origin,
the credential, or the raw error — sanitized observability, so a status endpoint cannot become a
configuration disclosure. Availability is an observation for recovery UX, not a lease.

Reconciliation itself pulls peer batches beyond the local frontier, pushes local batches beyond the
peer frontier, and returns both frontier receipts. It runs up to three immediate rounds when either
side advances mid-operation; persistent churn still yields `partial`, and rerunning continues safely
from the durable frontiers. The completeness verdict is `verified-complete | partial`
**(verified)** — never an unqualified success.

## 6. The endpoint surface

The authenticated slice, as built. Recorded because it is the concrete instantiation of the
`core.*` / `execution.*` / `sync.*` boundary the
[runtime topology note](2026-08-22-federated-runtime-topology.md) selects abstractly.

```text
GET    /v1/capabilities
GET    /v1/realm/frontier
POST   /v1/sync/export              POST /v1/sync/apply
POST   /v1/signed-sync/export       POST /v1/signed-sync/apply
GET    /v1/chats/:chatId/branches
POST   /v1/enrollment/challenges    POST /v1/enrollment/complete
DELETE /v1/enrollments/:nodeId
POST   /v1/runs
GET    /v1/runs/:runId/control?after=:eventCursor
POST   /v1/runs/:runId/events
POST   /v1/runs/:runId/commands     GET  /v1/runs/:runId/commands?after=:commandCursor
POST   /v1/runs/:runId/authority
GET    /v1/workspaces
POST   /v1/runs/:runId/workspace/enter    POST /v1/runs/:runId/workspace/exit
POST   /v1/workspace-entry-requests/:requestId/approve
GET    /v1/runs/:runId/workspace/binding
POST   /v1/runs/:runId/worktree/enter     GET  /v1/runs/:runId/worktree/binding
POST   /v1/runs/:runId/worktree/exit
POST   /v1/runs/:runId/sandbox/enter      GET  /v1/runs/:runId/sandbox
POST   /v1/runs/:runId/sandbox/exit
POST   /v1/runs/:runId/sandbox/commands
POST   /v1/runs/:runId/workspace          GET  /v1/runs/:runId/workspace
POST   /v1/runs/:runId/workspace/unavailable
POST   /v1/runs/:runId/workspace/recovered
POST   /v1/runs/:runId/workspace/choice
```

Two response conventions worth carrying:

- Command submission returns **201 fresh, 200 immutable replay, 202 exact concurrent duplicate** —
  three distinct outcomes rather than one ambiguous success.
- The command body is strict and **rejects environment, working directory, user, image, mount, and
  host path**. The README states the boundary explicitly: this is executor _transport_, not a
  model-facing permission tool, and the harness must classify and authorize code execution before
  ever calling it.

Run control persists only semantic state — status, published assistant output, authority transfers,
steering and cancellation commands. It copies no harness frames, queue jobs, model-provider buffers,
or process state. Every handoff, fallback, or recovery increments `authorityEpoch`; writes from the
prior executor then fail closed, and commands target one epoch so a replacement executor never
receives steering meant for the environment it replaced.

## 7. Operational caveats recorded at the time

- Plain HTTP peers and listeners are **restricted to loopback**; anything else needs HTTPS or an
  authenticated tunnel. The bearer token is never printed by the process.
- The database, private keys, credentials, and SQLite sidecars are forced to owner-only permissions,
  but **event content is not encrypted at rest**.
- Node 22's built-in SQLite API is marked experimental upstream — the prototype depended on it.
- Live Run-control HTTP writes still went to the prototype store; bridging them into signed Realm
  batches was never implemented, and Workspace recovery was unavailable for journal-only Runs.

## 8. How to read this

Vocabularies are the cheapest thing to get wrong and the most expensive to change once written into
a wire format. `run.execute` versus `run.control`, `wait` versus `fallback` versus `exit`,
`verified-complete` versus `partial` — each distinction here was forced by a concrete failure the
findings note explains. Reuse the distinctions; re-derive the encoding.

Nothing here is promoted. Any of it becomes normative only through an OpenSpec capability spec at
the ROADMAP stage that needs it.
