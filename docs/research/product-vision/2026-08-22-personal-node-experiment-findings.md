# Personal Node Experiment: Implementation Findings

Recorded 2026-08-22, extracted 2026-08-24. Active, noncanonical research adjacent to the
[federated runtime topology](2026-08-22-federated-runtime-topology.md),
[resource identity and change envelope](2026-08-22-federated-resource-identity-and-change-envelope.md),
[authority connections and writer grants](2026-08-22-authority-connections-and-writer-grants.md),
[control and replication topology](2026-08-22-personal-realm-control-and-replication-topology.md),
[cross-authority information flow](2026-08-22-cross-authority-information-flow-and-derived-data.md),
[schema evolution](2026-08-22-federated-schema-evolution-and-compatibility.md), and
[recovery and key lifecycle](2026-08-22-personal-realm-recovery-and-key-lifecycle.md) notes.

Those seven notes record decisions. This note records what building them broke. An executable
prototype — `apps/personal-node` and `packages/federation-experiment`, about 18.8k lines across
57 source files — was written against those contracts and then **closed unmerged**. The findings
below are the part worth keeping: each one is a place where the obvious implementation is wrong,
discovered by writing it.

## 1. Provenance and how to recover the code

The prototype lived in pull requests #494 through #512, stacked in that order. It is not merged
and will not be. Its tip commit is `25a4fd9976cb48b9e70d90e5e8803576d49b4b1c`
(`experiment/sandbox-command-authority-fence`).

It touched no shipped code — two new workspaces plus a `flake.nix` addition — which is precisely
why closing it was cheap and why nothing in it has ever run against a real Chat, Run, or owner.

## 2. How to read this note

These are **findings from an unshipped prototype**, not contracts. Nothing here is a specification,
and SPEC.md §1.1 continues to hold in full: no first-party Node enrollment, Personal Realm
mirroring, remote Workspace registry, cross-node execution placement, or foreign-authority mount
ships. ROADMAP keeps Sandbox execution, Personal Realm synchronization, and Workspace routing
behind the immediate file-native cut.

The value is negative knowledge — the cost of rediscovering each of these is a subtle correctness
or authority bug in a system where those are expensive. Treat a finding as a question the eventual
specification must answer, not as an answer it may adopt.

Claims marked **(verified)** were re-read in the prototype source during extraction. The rest are
as-reported by the experiment.

## 3. Replication and causal exchange

- **Receivers must enforce contiguous writer sequences.** Sender-declared causal dependencies
  cannot prove frontier completeness: a sender can honestly declare what it depends on and still
  omit an intermediate batch. Only the receiver, checking that each batch's sequence is exactly its
  predecessor plus one per writer stream, can tell a complete history from a plausible one.
  **(verified — `reconciliation.ts` rejects with an explicit `writer sequence gap` rather than
  accepting and repairing later.)**
- **Accepted batches must be copied at the receive boundary.** TypeScript `readonly` is a
  compile-time annotation with no runtime effect; a caller retaining a reference can mutate state
  the receiver has already validated and accepted. **(verified — the prototype `structuredClone`s
  every candidate batch before validation, and again when serving batches out.)**
- **Multiple processes opening one SQLite file must rehydrate under `BEGIN IMMEDIATE` before
  mutating.** Reading state, deciding, then writing under a deferred transaction lets a second
  process's commit land between the read and the write, so a stale replica corrupts the journal.
  **(verified — every mutating path in the prototype's replica store opens with `BEGIN IMMEDIATE`.)**
- **Disconnect after apply is outcome-ambiguous, and hiding that is the bug.** The sender cannot
  distinguish "the receiver applied and the ack was lost" from "the receiver never applied".
  Idempotent batch references make bounded recovery possible without collapsing the ambiguity into
  a false success or a false failure; an explicit `outcome_unknown` state is what preserves it.
- **An unknown semantic operation rejects its whole batch**, with no partial application and no
  frontier advancement. A node that skips operations it does not understand silently forks the
  meaning of the history while still claiming to be caught up — the failure mode the
  [schema evolution note](2026-08-22-federated-schema-evolution-and-compatibility.md) exists to
  prevent. All-or-nothing at the batch boundary is what makes "unknown ⇒ fail closed" enforceable.
- **Signing needs its own encoder; `JSON.stringify` is not one.** The prototype signed a
  domain-separated, field-ordered encoding, and deliberately restricted `JSON.stringify` to being an
  in-process payload-equality sentinel — never the bytes under a signature. It also declined to call
  that encoder canonical: it is one TypeScript implementation, not a cross-language canonicalization
  standard, and a second-language implementation is where that claim would actually be tested.
- **Initial synchronization does not need a second protocol.** Immutable Run semantics can use the
  same causal frontier and signed batch exchange as later incremental updates. A separate bootstrap
  path is a second implementation of the same invariants, with its own bugs.

## 4. Identity has more than one axis

- **Transport identity is not writer identity.** A bearer credential authenticates a _peer_; it
  says nothing about who authored an event that peer forwards. Forwarded events need their own
  writer signature, or a compromised or merely relaying node can attribute writes to anyone.
- **Node identity is not writer identity, and must not be.** Keeping them separate is what lets a
  node be unlinked or replaced without invalidating the history it authored. Fusing them makes
  revocation retroactively destroy verifiable history.
- **Node identity is not user authority.** A central node needs a scoped `run.control` delegation.
  Sharing the remote owner's secret, or treating a node's own identity as if it carried the owner's
  authority, are both wrong for the same reason: they widen a transport fact into a permission.
- **Writer trust binds `writerStreamId` plus `writerEpoch` to a public key**, so key rotation
  preserves verification of everything signed before it. A key-to-identity binding without an epoch
  forces a choice between never rotating and losing historical verifiability.
- **Enrollment must reserve local credential storage before mutating remote state.** Otherwise a
  local collision after a successful remote call strands an active remote grant that the local node
  cannot use or revoke.
- **An upstream must not sign enrolled executor events under its own writer.** Local daemons author
  with their own writer keys and synchronize the resulting immutable batch; an upstream that
  re-signs is laundering authorship.
- **Unsigned compatibility sync cannot carry authority-bearing operations.** It cannot prove the
  claimed writer stream, so it must be restricted to data that carries no authority. Allowing it
  "just for bootstrap" reintroduces exactly the forgery the signatures exist to prevent.
- **Verification authority and authoring authority are separate capabilities.** A node that can
  verify and project signed Run state does not need a private writer key. Read-only mirrors are a
  first-class deployment, not a degraded one.
- **Trusted writer identity alone is too broad for control state.** Operation grants must
  distinguish `execute`, `steer`, and `control`, and `execute` must name the node identities that
  writer may act through. One "trusted writer" bit collapses the entire authority model.

## 5. Run control and execution authority

- **Replicate semantic Run state and command receipts, not executor internals.** Queue rows,
  process state, and raw harness frames are local execution detail; replicating them couples every
  node to one executor implementation and leaks state that has no meaning elsewhere. This mirrors
  SPEC's existing rule that `run_events` is installation-local reconnect state, not a cross-node
  protocol.
- **Authority transfer must fence the old executor and filter old-epoch commands.** Both halves are
  required: stopping old writes is not enough if commands issued under the previous authority still
  reach the replacement executor.
- **Workspace recovery and Run authority must commit atomically.** A recovery decision that moves
  execution without moving authority — or the reverse — produces a Run that two nodes each believe
  they may advance.
- **A stale observation can preserve context, but never authority.** Showing the last known state
  during disconnection is good product behavior; it must retain an error status and must never
  satisfy a check that asks who may act.
- **Mirror freshness is temporal, not implied by state existing.** Expose the last verified
  reconciliation time. State that is present but hours old looks identical to current state unless
  freshness is a value the caller can read.

## 6. Routing is not authority

- **Several nodes need one stable client endpoint, but routing must stay explicit per Run.**
  Automatic peer selection silently changes the execution environment a Run is in — a correctness
  change disguised as a convenience.
- **Route reassignment is not authority transfer.** A router can prove that source and target
  semantic histories agree before committing a rebind, but replication and authority movement stay
  separate operations. Conflating them is how two executors end up believing they hold the same Run.
- **Route epochs do double duty**: they protect concurrent control-plane edits, and they namespace
  cached state so a previous peer's cache cannot surface after a rebind.
- **Peer availability is an observed hint, not a lease.** It is useful for recovery UX and proves
  nothing about whether the peer will accept the next operation.
- **Allowlisting a route was not legible to static analysis.** Cloning the trusted origin and
  assigning path and query separately makes the host-authority invariant structural, and CodeQL can
  then see it. Worth copying as a pattern: express the invariant in the construction, not in a
  preceding check.

## 7. Workspace placement and approval

- **Workspace entry policy comes from operator configuration, never the tool caller.** Enabling a
  registry must disable any caller-supplied affinity path; leaving both live means the model-facing
  path silently wins.
- **Workspace paths belong on the executor side of the contract.** Controllers select opaque IDs;
  only the executor currently holding execution authority resolves its local binding. This keeps
  host paths out of the control plane and out of anything a model or owner surface can read.
- **Registration proves operator intent, not current availability.** Binding must check the live
  root and feed failure into recovery policy rather than returning a stale path.
- **An approval prompt is durable control state, not UI ephemera.** It must survive restart, and a
  failed settlement must not silently erase it.
- **Approval intent must not float across authority transfer.** A prompt raised for one executor and
  authority epoch cannot authorize binding on a replacement. Fence the decision to what was shown.
- **Permission is scoped to the entry transition, not to every follow-up.** Durable affinity is the
  proof that no new approval is needed — otherwise the choice is between re-prompting forever and
  granting more than was asked.
- **Explicit exit is not failure or fallback.** Permanent exit needs its own durable audit
  transition, distinct from temporary fallback, while execution continues in place.
- **Wrapper CLIs change the process working directory.** Caller-directory intent must be captured
  explicitly, or a package-manager wrapper advertises the wrong Workspace. This one applies directly
  to the CLI cut, where the advertised directory _is_ the trust boundary.
- **Policy-gated affinity can ship before filesystem binding**, but the capability must say so
  rather than claiming executable placement it does not have.

## 8. Sandbox and worktree execution

The most reusable code in the experiment, and the section most worth re-deriving rather than
re-inventing when ROADMAP reaches local Sandbox execution. The full confinement posture — the exact
`docker create` contract, the command bounds, the observation discipline, the reproducible Nix base
image, and its known gaps — is recorded separately in
[the local Sandbox confinement contract](2026-08-22-local-sandbox-confinement-contract.md); the
findings below are the reasoning behind it. The endpoint surface, scope and status vocabularies, and
`ask | wait | fallback | exit` policy semantics are recorded in
[the protocol slice note](2026-08-22-personal-node-protocol-slice.md).

- **Observe the isolation state; do not assume the launch contract held.** The prototype inspects
  the running container and compares network mode, IPC and cgroup namespaces, dropped capabilities,
  `no-new-privileges`, read-only root, and the PID ceiling against the plan, refusing a same-named
  container with weaker isolation. **(verified — the Docker adapter validates inspect output as
  untrusted input with a schema, then maps it to observations.)** A launch that succeeded is not
  evidence of the confinement you asked for.
- **Pin images by digest and disable pulls.** A mutable tag makes the sandbox's contents a function
  of the registry at launch time, which defeats both reproducibility and review.
- **Argv arrays via `execFile`, never a shell.** Combined with a fixed working directory and a
  numeric non-root user, this removes the entire quoting-and-injection class rather than filtering it.
- **Bound the command, then tear down on breach.** Timeout, output buffer, argument count and size
  caps; exceeding a boundary removes the container rather than returning a truncated success.
- **Worktree creation needs a `pending` → `active` state, not a post-hoc insert.** Recording the
  binding only after Git succeeds leaves orphaned checkouts on crash; recording it before, and
  promoting it after verifying the on-disk worktree and branch, makes recovery decidable. Recovery
  runs out-of-band at boot, never inside `enter()`. **(verified — the schema carries a `state`
  column with a runtime migration defaulting existing rows to `active`.)**
- **The worktree root must resolve outside the repository, with symlinks resolved.** The prototype
  `realpath`s both roots, confirms the configured repository root _is_ the Git toplevel, and refuses
  a worktree root that lands inside it. Comparing unresolved paths passes a symlink that points back
  into the repository. **(verified.)**
- **A dirty worktree refuses removal.** Exit removes only clean worktrees and leaves branches in the
  repository; silent cleanup of uncommitted work is unrecoverable data loss.
- **Command execution needs at-most-once semantics with immutable receipts.** Reserve, execute once,
  replay the receipt thereafter; interrupted commands become `outcome_unknown` on reopen and are
  never auto-retried. **(verified.)** Note that llame already owns durable-job semantics in pg-boss;
  this is only interesting where a local node has no PostgreSQL.
- **Sandbox and worktree lifecycle is owner-reserved, command execution is not.** In the prototype's
  route table, `sandbox/enter`, `sandbox/exit`, `worktree/enter` and `worktree/exit` require the
  `owner` principal, while running a command inside an already-created Sandbox requires only
  `run.execute`. An enrolled executor can therefore work inside a confinement boundary it cannot
  create, widen, or tear down. **(verified.)** Creating the boundary and using it are different
  authorities; collapsing them hands an executor the power to define its own confinement.
- **Authority transfer must be rejected while a command is in flight or its outcome is unknown**,
  with single-use transition leases closing the window between the quiescence check and the
  authority mutation. The prototype proves same-daemon fencing only; a disconnected remote executor
  still needs tunneled coordination or an explicit ambiguity-preserving fallback decision.

## 8a. Cross-cutting disciplines, read from the refusals

Not from any pull-request body: these emerged from reading all 189 distinct refusal messages in the
archived source. Each is a rule the prototype applied everywhere rather than in one feature.

- **Persisted state is re-validated by replay on load, never trusted.** A whole family of refusals —
  _stored Run authority event does not replay_, _stored Run command sequence does not replay_,
  _stored Workspace recovery state does not replay_ — exists because reading a row back is treated as
  a claim to be checked against the semantics that produced it, not as a fact. Corruption and version
  skew surface at load, loudly, instead of silently becoming current state.
- **Idempotency keys bind to their payload.** _Run event identity reused at another sequence_,
  _sequence reused with different payload_, _batch reference reused with different payload_,
  _command identity reused with different payload_: reuse of an identity with different content is a
  **conflict**, never an overwrite and never a silent replay. An idempotency key that does not check
  what it is keying is a corruption vector wearing a safety label.
- **Every durable store is bound to exactly one Realm and refuses to be reused across Realms.** The
  same guard is repeated in the Realm store, the Run-control store, the Sandbox command store, and
  the enrollment registry. Cheap to write, and it turns a catastrophic mix-up into a startup error.
- **Durable state refuses an ephemeral database.** Stores that carry authority reject `:memory:` and
  demand a real path, so a configuration mistake cannot quietly produce a node whose history
  evaporates on restart.
- **Peer and upstream responses are untrusted, bounded, and shape-checked.** _Response is too large_,
  _is not valid JSON_, _has no body_, _has invalid shape_ — the same discipline llame already ships
  for MCP bounded fetch, applied to every federation hop. A peer is a remote party, not a library
  call, even when it is your own laptop.
- **Terminal state is immutable, and the prototype re-derived it independently.** _Terminal Run state
  is immutable_, _terminal Run authority cannot transfer_, _terminal Run cannot accept commands_ —
  arrived at from first principles here, and identical to SPEC §9.3. Convergence on the same
  invariant from a different starting point is mild evidence the invariant is right.
- **Enrollment challenges are single-use, replay-proof, and short-lived**, with a lifetime bounded to
  at most five minutes, explicit expiry, explicit already-consumed rejection, and a key-id match
  requirement on the proof.
- **Credential files must be owner-only, and the process never prints them.** File mode is checked,
  not assumed; a world-readable peer credential is a startup refusal rather than a warning.
- **Epochs advance monotonically and detect concurrent movement.** _Writer epoch must advance_ and
  _writer epoch changed concurrently_ are the two halves that make an epoch a fence rather than a
  label.

## 9. Deliberate limits of the prototype

As stated by the experiment itself, and worth preserving so nothing here is read as further along
than it is. It had explicit writer signatures, node enrollment and revocation, resumable semantic
Run control, signed shared-log Run projection with local authorship, read-write and read-only
journal-backed APIs, continuous single-peer reconciliation, policy-gated Workspace affinity with
executor-only path resolution, and fixed plus multi-peer Node proxies.

It had **no** automated key rotation, cross-language canonical encoding standard, encrypted
payloads, snapshots, journal-backed Workspace recovery, managed sandbox mounting, native external
harness streaming adapter, peer discovery or automatic selection, atomic coordination between route
rebind and remote Run-authority transfer, OAuth bootstrap, or hosted PostgreSQL adapter. Enrolled
transport credentials remained bearer tokens throughout.

## 10. What this experiment does not establish

The honest counterweight, and the reason the code is closed rather than merged:

1. **There is no agent loop in it.** Fifty-seven source files of synchronization, enrollment,
   run-control, routing, workspace, worktree, and sandbox machinery, and zero model calls, tools, or
   chat. It is placement and transport for Runs that do not exist locally, so none of its contracts
   has been falsified by contact with a real one.
2. **It stands up a second identity and authority system** — writer streams, node enrollment, bearer
   node credentials, per-writer operation grants — parallel to the RLS and opaque-session model
   `apps/api` owns. The findings in §4 are real, but they are findings about a system llame has not
   decided to have.
3. **It fixes stage-three-to-five contracts while stages one and two are unshipped.** Epoch-fenced
   coordinators, route CAS, recovery generations and capability negotiation will all be re-derived
   once a local Node with a real run loop exists. The findings survive that re-derivation; the code
   mostly will not.
4. **Passing tests are not validation here.** The prototype's suites are internally consistent with
   its own model of the world. Nothing in them checks that model against a shipped Chat, Run, owner,
   or executor.

The pattern is worth naming for future work: this is correct code answering a question the product
has not asked yet. The defect is sequencing, not craft.

## 11. What to re-derive, and when

| Material                                                    | ROADMAP stage                                   | Note                                                                                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Sandbox launch contract and Docker inspect adapter (§8)     | Then: local Sandbox execution                   | The security-critical part. Recorded in full, standalone, in [the confinement contract note](2026-08-22-local-sandbox-confinement-contract.md). |
| Reproducible Nix sandbox base image                         | Then: local Sandbox execution                   | Derivation reproduced verbatim in the same note; verified by a real detached offline container run.                                             |
| Worktree manager with `pending`/`active` recovery (§8)      | Then: local Sandbox execution                   | Matches VISION's "worktrees are derived Workspace views, not replicas".                                                                         |
| Workspace approval and placement findings (§7)              | After personal synchronization                  | The wrapper-CLI cwd finding applies earlier, to the CLI cut.                                                                                    |
| Replication, identity, routing and control findings (§3–§6) | Then: Personal Realm synchronization, and later | Questions the specification must answer; not a design to adopt wholesale.                                                                       |

Nothing in this table is a commitment. Promotion of any of it into VISION, SPEC, or an OpenSpec
capability is a separate deliberate act, after the immediate file-native cut ships.
