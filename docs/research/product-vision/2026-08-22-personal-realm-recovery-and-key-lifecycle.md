# Personal Realm recovery and key lifecycle

- **Status:** selected north-star direction with a deliberately simpler initial
  boundary; not a shipped contract
- **Date:** 2026-08-22
- **Confidence:** high for separating recovery, operational control, node, and
  data-backup keys; moderate for future multi-principal recovery UX

## 1. Decision

Personal Realm recovery is a distinct, pre-authorized authority path. It is not
automatic replica election, possession of a full data mirror, ordinary account
login, or restoration of a copied node private key.

The Realm's control history names a versioned **Recovery Policy**. That policy may
disable identity-preserving recovery, name one offline recovery principal, or
require a threshold of independent recovery principals. A valid recovery
transition advances a monotonic **recovery generation**, selects a successor Realm
Control Coordinator, and permanently fences every coordinator from earlier
generations.

Routine control continues under the online coordinator and control epoch.
Recovery authority stays off that hot path. Recovery-policy replacement requires
the existing recovery threshold and proof of the new policy; a compromised
operational coordinator cannot silently replace its own recovery authority.

The initial implementation remains smaller: node identities are disposable,
linked-hub continuity relies on the hub's existing account and operator
durability, and permanent loss without a previously configured recovery path
produces a visible new Realm/fork. The first personal-node slice does not need
threshold cryptography or a recovery kit. The north star records how the same
Realm identity can later be recovered without redefining full replicas as
authorities.

## 2. Separate the keys by consequence

One “master key” would concentrate unrelated failure domains. The conceptual
roles are:

| Role                  | Purpose                                                                                  | Expected custody                                                                        | Loss or compromise                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Recovery principal    | Authorize a successor recovery generation and replace Recovery Policy                    | Offline kit, hardware-backed credential, explicitly trusted custodian, or threshold set | Loss may make same-Realm recovery impossible; compromise may seize Realm governance  |
| Control coordinator   | Author routine enrollment, revocation, Writer Grant, policy, and coordinator transitions | Online current coordinator                                                              | Loss blocks governance until recovery; compromise affects current control generation |
| Node principal        | Authenticate one enrolled node/profile and its channels                                  | Local OS/device keystore                                                                | Revoke and re-enroll; private key is not synchronized                                |
| Writer stream key     | Attribute batches issued under a Writer Grant                                            | Node-local or delegated signer                                                          | Fence stream/grant; accepted history keeps its author identity                       |
| Broker credential     | Access an upstream authority or inference provider                                       | Owning broker only                                                                      | Revoke upstream; never restored from Realm sync                                      |
| Backup encryption key | Protect an exported data backup                                                          | User-selected backup custody                                                            | Loss loses that backup; possession does not grant Realm control                      |

An implementation may bind some operational roles to one hardware key initially,
but the protocol and UI do not claim their authorities are equivalent. In
particular, a backup password or full database copy cannot authorize a new control
head.

## 3. Alternatives considered

### A. Any full replica may recover the Realm

Let one or several data replicas elect a new coordinator when the old one is
unreachable.

**Strength:** no separate recovery setup and high apparent availability.

**Failure:** absence is not proof of loss. A partitioned or malicious replica can
create a second control head, and copied mirrors become latent governance keys.
Replica quorum is also ambiguous: clones and stale devices are not independent
people or trust domains.

**Decision:** rejected. Replicas count only when explicitly named as recovery
principals by prior policy.

### B. The linked hub always recovers every Realm

Treat account recovery at the hosted service as universal Realm recovery.

**Strength:** familiar UX and simple support path.

**Failure:** makes the optional hub a hidden canonical authority, couples Realm
seizure to email/OAuth/support recovery, and does nothing for standalone or
self-hosted loss. A hub breach would inherit every linked Realm's root authority.

**Decision:** rejected as the product invariant. A hub may be an explicit recovery
principal or current coordinator, never an implicit universal root.

### C. One exported Realm root private key

Generate a recovery phrase/file whose key can always appoint a new coordinator.

**Strength:** portable, offline, independent of any service, and implementable.

**Failure:** a single copy is both a catastrophic theft target and a permanent
availability dependency. Rotation and stale-root handling still require a
versioned trust chain.

**Decision:** retained as one simple future Recovery Policy profile, not the only
model.

### D. Versioned Recovery Policy with explicit principals and thresholds

Anchor recovery in prior control state, separate it from operational keys, and
allow disabled, one-principal, or threshold custody profiles.

**Strength:** preserves optional hubs and full mirrors, supports independent
custody, and makes compromise/availability tradeoffs explicit.

**Cost:** recovery must be configured before loss. Threshold UX and secure custody
are substantial product work, not a checkbox.

**Decision:** selected as the north star.

## 4. Recovery Policy

The accepted control history contains policy equivalent to:

```text
realm_id
recovery_policy_version
recovery_generation
recovery principal public identities
required signature or approval threshold
allowed recovery operations
optional delay, notification, or high-assurance requirements
previous policy and control-head references
```

This is conceptual shape, not a wire schema. Recovery principals are authority
identities, not necessarily raw signing keys. A profile might use an offline key,
hardware authenticator, hub escrow service, or explicitly delegated trusted
person. Each adapter must still produce durable authenticated evidence for the
exact recovery statement.

Recovery disabled is a valid policy. Its consequence is explicit: permanent
coordinator loss preserves/export data but requires a new Realm authority.

A threshold set counts distinct configured principals, not whatever number of
online replicas happen to answer. The policy must not infer independence from
device IDs or network endpoints.

## 5. Two-dimensional fencing

Routine control records advance within one recovery generation:

```text
(recovery_generation, control_epoch, control_head)
```

A graceful coordinator transfer advances `control_epoch`. A recovery transition
advances `recovery_generation`, names a successor coordinator and starting control
head, and dominates every control epoch in the previous generation.

Receivers therefore reject:

- later-looking timestamps from an old generation;
- an old coordinator that returns after recovery;
- a recovery statement under an obsolete Recovery Policy; and
- a concurrent successor that does not extend the accepted recovery chain.

Recovery does not prove the lost coordinator authored no unseen records. The
transition chooses an explicit last accepted control head. Later-discovered old-
generation control or data work is retained as evidence/candidate material when
safe, never silently inserted before the new head.

Automatic failure detection may alert or start a user workflow. It cannot author
the recovery transition.

## 6. Recovery-policy rotation

Replacing recovery authority is itself a root operation. A new policy is accepted
only when:

1. the existing Recovery Policy's threshold authorizes the exact replacement;
2. the new principals prove control according to the new threshold;
3. the statement extends the accepted policy version and recovery generation;
4. current control state is referenced or explicitly fenced; and
5. every receiver can verify the transition chain from a previously trusted
   policy.

This dual authorization prevents an attacker holding only the new keys from
inserting them and prevents a compromised coordinator from deleting the recovery
path. If the old threshold has already been lost, it cannot be bypassed by UI
confirmation. The honest result is recovery disabled in practice and, after
coordinator loss, a new Realm.

Recovery principals should be replaceable before loss. The UI should report
policy health: configured threshold, reachable/tested principals where knowable,
last verification date, and whether current custody has a single point of
failure. It must not upload a recovery secret merely to test that it exists.

## 7. Node and writer key lifecycle

Node keys remain local and normally disposable.

### Routine rotation while the node is authenticated

A future identity-preserving rotation may bind a new public key to the same
`node_id` when the old node key proves continuity and the current coordinator
accepts the transition. A node-key epoch fences the old key. Historical batches
remain attributed to the same node principal and exact signing key evidence.

### Lost or compromised node key

The node principal is revoked. A replacement profile generates a fresh key and
`node_id`, re-enrolls, and receives new Writer Grants. Recovery authority does not
resurrect the lost device identity or export its private key. The historical
principal remains in provenance.

### Writer-stream rotation

Writer stream identity is not derived from one public key. The governing grant
may rotate its authorized signer at an exact cutoff while preserving accepted
stream history. Offline batches around that cutoff follow the existing candidate
or fork rule; possession of an old signer cannot cross the fence.

The first implementation keeps the simpler current decision: unlink/revoke and
relink creates a new disposable node principal. Identity-preserving rotation is
north-star behavior, not a prerequisite for enrollment.

## 8. Data backup is not authority recovery

Full mirrors improve availability but do not guarantee that any copy is current,
complete, or decryptable. An exportable backup should carry:

- portable resource snapshots and subsequent batches or Git objects;
- control and Recovery Policy history needed to verify them;
- declared resource and artifact coverage/frontiers;
- integrity metadata; and
- no node, broker, provider, or reusable enrollment private secrets by default.

Backup encryption is a separate envelope. Its recovery secret may be stored near
a Realm recovery kit for convenience, but they remain separate capabilities and
are labeled separately. Restoring bytes first reconstructs verified data. It does
not appoint the restorer as coordinator.

An encrypted backup may be imported into:

- the same Realm when valid control/recovery authority is also available;
- a read-only verifier/exporter; or
- a visibly new recovered Realm with source provenance when authority is lost.

“Backup succeeded” means the artifact was verified and its coverage recorded, not
merely that a file was written.

## 9. Hub and standalone profiles

### Initial linked product

The hub is the current Realm Control Coordinator and relies on its ordinary
service durability and authenticated account access. This is operational
recovery, not proof that another node can recover after permanent hub loss. Until
a Recovery Policy feature ships, the UI must not promise identity-preserving
re-homing after such loss.

### Future personal recovery kit

The user may configure one offline recovery principal and export a recovery kit.
The kit contains authority material and verification instructions, not a hidden
copy of all Realm data. Loss of both coordinator and kit yields a new Realm.

### Future threshold policy

The user may require, for example, two of three independently held principals:
an offline personal key, a hardware-backed device, and an explicitly opted-in hub
or trusted person. A trusted person signs only the recovery transition; they do
not automatically receive Realm contents or become a replica.

No profile is universally recommended before threat model and UX testing. A
one-principal kit favors independence; hub escrow favors convenience; threshold
custody reduces single-key risk but increases lockout and support complexity.

## 10. Scenario checks

### Laptop node key is stolen

An online coordinator revokes the node and writer cutoff. The owner enrolls a new
profile with a fresh identity. Realm recovery is not invoked, other nodes do not
receive the stolen private key, and old offline work remains candidate material.

### Hub coordinator is permanently lost

With no configured Recovery Policy, replicas export or form a visibly new Realm.
With a valid policy, its threshold authorizes a transition to a selected personal
node and a higher recovery generation. Every replica fences the hub's old
generation if it later reappears.

### One recovery principal is lost

If the remaining principals still satisfy the threshold, they rotate policy to a
new set using old-threshold and new-threshold proof. If not, routine Realm use may
continue while the coordinator survives, but same-Realm recovery is no longer
possible. The product reports that condition instead of weakening the threshold.

### Recovery secret is suspected compromised

The current threshold rotates Recovery Policy immediately. Routine data does not
need new identities, but every replica must learn the new policy chain before
trusting a later recovery. If the attacker already satisfied the threshold and
advanced recovery first, this is an authority compromise, not a merge conflict.

### Old coordinator returns after recovery

Its control and Writer Grant state belongs to an earlier recovery generation. It
may contribute retained portable data only under the new authority's acceptance
rules. It cannot resume coordinator status from local recency or possession of
the old key.

### Backup is restored without recovery credentials

The user can inspect/export verified contents or import them into a new Realm with
source provenance. The restore process cannot issue a same-Realm control head.

## 11. Security invariants

- Full data possession does not grant control authority.
- Ordinary account authentication does not imply Realm root recovery unless the
  Recovery Policy explicitly names that service/principal.
- Recovery generation dominates every earlier coordinator epoch.
- Recovery-policy rotation chains from the old threshold and proves the new one.
- Node and broker private keys never synchronize through ordinary Realm data.
- Lost node identity is revoked and replaced; recovery does not resurrect it.
- Backup decryption and Realm governance are separate capabilities.
- No automatic election converts connectivity loss into broader authority.
- A failed threshold produces unavailability or a new Realm, never a lower
  threshold.

## 12. Evidence from existing systems

The selected shape borrows narrow trust-management lessons, not wire protocols:

- [The Update Framework](https://theupdateframework.github.io/specification/draft/)
  separates offline root authority from online roles, supports signature
  thresholds, and requires root rotation to verify under both prior and new root
  metadata. llame needs the same trust-chain property, not TUF repository formats.
- [Matrix cross-signing and secret storage](https://github.com/matrix-org/matrix-spec/blob/main/content/client-server-api/modules/end_to_end_encryption.md)
  separates user cross-signing keys, device keys, and encrypted secret recovery,
  and treats reset as a visible trust change. llame's Realm governance and data
  semantics remain different.
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) distinguishes
  single-device from backup-eligible credentials. A WebAuthn/passkey adapter may
  implement one recovery principal, but synced credential custody must not be
  mistaken for independent threshold custody.

## 13. Simple-first boundary

The first personal-node experiment should:

- generate disposable local node keys;
- keep private keys out of portable synchronization;
- use the linked hub as the initial online coordinator;
- preserve explicit control history and recovery-generation-ready identifiers;
- report that permanent coordinator loss without configured recovery creates a
  new Realm; and
- test revocation and re-enrollment with a fresh node principal.

It should not implement:

- Shamir secret sharing or custom threshold cryptography;
- automatic replica elections;
- social-recovery contact graphs;
- identity-preserving lost-node restoration;
- generic hardware-wallet/passkey abstractions; or
- provider-independent encrypted backup before one portable resource exists.

The north-star data model should avoid making those later additions impossible,
but no speculative recovery service belongs in the first slice.

## 14. Implications for the current repository

This direction changes no current authentication, database, key storage,
deployment, OpenSpec, or roadmap behavior. The current multi-user installation
continues to derive user authority from authenticated sessions and enforce tenant
isolation in PostgreSQL.

A future enrollment slice must threat-model local key storage, channel binding,
revocation cutoff, and fresh-principal re-enrollment. A future recovery slice must
add negative tests for stale-generation coordinators, insufficient thresholds,
policy rollback, backup-without-authority, and recovery-auth downgrade.

## 15. Deliberate deferrals

This decision does not choose:

- signature algorithms, canonical encoding, or threshold implementation;
- platform key stores, hardware authenticators, or recovery-kit format;
- default recovery profile or warning cadence;
- recovery delays, emergency cancellation, or support escalation;
- encrypted backup format, retention, and storage providers;
- foreign/shared-authority recovery governance; or
- legal/organizational custody for work and family authorities.

## 16. Next architectural decision

The next federation dependency is **replica coverage, retention, and pruning**.
“Full mirror” needs a verifiable completeness contract over portable Chat/Run
history, deletion records, artifacts, and snapshots, plus rules for what may be
compacted without making recovery or reconciliation dishonest.

## 17. Promotion boundary

This note records a vision architecture decision. `VISION.md` owns the durable
principles. `SPEC.md`, OpenSpec, ROADMAP, and the shipped runtime remain unchanged
until a focused capability is selected.
