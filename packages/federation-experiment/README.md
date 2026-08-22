# Federation reconciliation experiment

Executable spike for the Personal Realm synchronization semantics in `VISION.md`.
It is a private workspace package, not shipped runtime code or a stable protocol.

The experiment currently proves:

- authorized immutable batches advance a per-writer frontier;
- a receiver enforces writer-sequence continuity instead of trusting dependency
  claims;
- a new replica backfills the same causal journal used by later reconciliation;
- concurrent offline Chat continuations converge into deterministic branches;
- an authority epoch fences obsolete offline writers;
- identical delivery is idempotent while batch-reference or resource-identity
  reuse fails closed;
- an unknown semantic operation rejects its whole batch without partial state or
  frontier advancement; and
- accepted batches are copied at the receive boundary so later caller mutation
  cannot rewrite forwarded history; and
- Ed25519 signatures bind a batch to an explicitly trusted writer stream and
  reject forwarded payload mutation or cross-writer impersonation; and
- a short-lived, Realm-bound enrollment challenge proves possession of a
  separate Ed25519 node identity without introducing a local `user_id`, while
  explicit sync/observe/steer/execute/control scopes attenuate the issued
  credential; and
- resumable Run-control state uses semantic event and command cursors plus an
  authority epoch that fences a stale executor after handoff or fallback; and
- sticky Workspace affinity exposes `ask`, `wait`, egress-gated temporary
  `fallback`, permanent `exit`, and automatic restoration as semantic effects
  for both UI and model transparency.

`apps/personal-node` now exercises this core through a durable embedded store and
an authenticated HTTP contract. Signature v1 uses a domain-separated,
field-ordered JSON encoding inside this TypeScript experiment; it is not a claim
of cross-language canonicalization. The package still deliberately does not
choose snapshots, automated key rotation, or a public package API. The Personal
Node app additionally exercises a stateless same-contract proxy; that transport
remains outside this semantic core.
`JSON.stringify` remains only an in-process payload-equality sentinel outside
that explicitly ordered signature encoder. The next valuable boundary is a
real external-harness adapter behind the Run-control API, followed by a second
implementation of the reconciliation contract against the hosted PostgreSQL
projection.
