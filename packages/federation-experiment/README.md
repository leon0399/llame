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
  cannot rewrite forwarded history.

`apps/personal-node` now exercises this core through a durable embedded store and
an authenticated HTTP contract. The package still deliberately does not choose
canonical encoding, signatures, snapshots, enrollment, or a public package API.
`JSON.stringify` is only an in-process payload-equality sentinel here, not the
future integrity format. The next valuable boundary is a second implementation
of the same reconciliation contract against the hosted PostgreSQL projection.
