# Authority connections and writer grants

- **Status:** selected vision direction; not a shipped contract
- **Date:** 2026-08-22
- **Confidence:** high for trust-object separation and credential locality;
  moderate for populated-Realm join mechanics

## 1. Decision

llame uses two different link relationships:

1. **Personal Replica Enrollment** authenticates one node profile as a replica of
   one Personal Realm. It enables full personal mirroring, remote coordination,
   and Realm-authorized writer streams. It does not create a foreign account
   mount.
2. **Authority Connection** authenticates a local profile as one authority-local
   subject at a work, family, school, community, forge, or other foreign
   authority. It exposes exact mounted resources and policy. It does not enroll
   that authority as a personal replica or merge user identities.

One local profile has one active Personal Realm and may have many Authority
Connections, including more than one subject at the same authority. Every mount
selects an exact connection; there is no ambient “current work account.”

Authorship is a third object. A **Writer Grant** is durable, non-secret authority
state that binds an authority-scoped author stream to allowed record kinds,
resources, operations, Authority Binding revisions, and offline mode. A short-lived
credential proves that the current caller may exercise the grant. The credential
is not the grant, and naming a grant in a request does not authorize it.

Long-lived refresh credentials and private keys stay at one explicit connection
broker node. Other nodes and executors use brokered operations or narrowly scoped,
short-lived, audience-bound delegation. Personal, work, family, and inference
credentials are never copied merely to make every Surface look connected.

## 2. The trust objects

| Object                      | Durable meaning                                                                            | Secret material                                           | Portable scope                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Personal Replica Enrollment | Node principal is admitted to one Personal Realm with specific replica/writer capabilities | Node private key and renewable link credential stay local | Non-secret enrollment identity, status, and grant history may synchronize     |
| Authority Connection        | One profile authenticated as one subject at one foreign authority through one broker       | Refresh/access credentials stay at the broker             | Non-secret authority and mount descriptors may synchronize when policy allows |
| Writer Grant                | Authority permits one author stream to perform exact semantic operations                   | None; it is authorization state, not a bearer secret      | Authority history and affected replicas                                       |
| Mount                       | Profile may discover and route to one exact foreign resource through one connection        | None                                                      | Personal presentation metadata, subject to source policy                      |
| Delegation                  | One executor may perform a bounded operation for a subject and connection                  | Short-lived token or proxied request                      | Never a reusable upstream credential                                          |

The separation prevents three recurrent category errors:

- authenticating a person to approve node enrollment does not make the node that
  person;
- holding a full replica does not grant every author stream or admin operation;
  and
- having a foreign account connection does not import its resources into the
  Personal Realm.

## 3. Alternatives considered

### A. One central personal broker owns every credential

Every Surface and executor asks the hub to call work, family, forge, and inference
providers.

**Strength:** simple multi-device UX and one place to refresh or revoke tokens.

**Failure:** the optional hub becomes mandatory for foreign access and a
high-value universal credential vault. Offline personal nodes cannot use their own
connections, and a hub compromise crosses every authority boundary.

**Decision:** rejected as the only topology. A hub may be one broker, not the
broker for every connection.

### B. Mirror credentials to every Personal Realm replica

Synchronize OAuth refresh tokens, provider keys, and connection configuration so
every device is independently capable.

**Strength:** maximal offline capability and no broker dependency.

**Failure:** every enrolled device becomes a copy of every upstream secret.
Revocation, lost-device response, Android compromise, work-policy enforcement, and
cross-account separation become materially worse. Secret replication is not full
personal mirroring.

**Decision:** rejected.

### C. Broker-local credentials with portable descriptors and narrow delegation

Each connection chooses a broker node. Other authorized surfaces route exact
operations to that broker or receive an audience-, resource-, action-, executor-,
and expiry-scoped token when the upstream supports safe delegation.

**Strength:** preserves credential locality, allows several brokers, works with
ordinary OAuth/OIDC, and keeps the hub optional. A mount can remain visible while
its broker is offline without pretending the resource is empty.

**Cost:** availability is per connection, and not every provider supports token
exchange or fine-grained delegation. Proxying is therefore a first-class path,
not a fallback embarrassment.

**Decision:** selected.

## 4. Personal Replica Enrollment

A personal node profile creates a local keypair and `node_id`. A browser or device
authorization flow authenticates the user only long enough to approve enrollment.
The receiving hub or Realm coordinator binds the public key to one account, one
Personal Realm, and explicit capabilities, then issues a narrow renewable link
credential bound to proof of the node key.

The daemon does not receive the user's general web session. The hub does not send
its inference-provider secrets. Every synchronization, tunnel, and coordination
request derives its node principal from the authenticated channel, never a
caller-supplied `node_id`, `user_id`, Realm ID, or grant ID.

Sender-constrained OAuth tokens such as DPoP-bound tokens are a strong candidate
for HTTP transports because a stolen token alone is not sufficient. Local IPC may
use an OS-protected endpoint plus a profile-owned secret. The Node Protocol keeps
the authenticated-principal semantics common without requiring one credential
mechanism on every transport.

Enrollment capabilities are explicit. Examples include:

- retain and synchronize specified Personal Realm resource classes;
- originate specified additive personal records while offline;
- broker inference or foreign connections;
- expose an `execution.*` endpoint or Workspace registry; and
- coordinate tunnels or placement fencing.

Capability discovery reports what the enrolled node may do now. It never returns
private keys, tokens, provider secrets, raw Workspace paths, or authorization
claims the channel has not established.

## 5. Realm identity during link

Enrollment can start ordinary synchronization only after both sides agree which
Personal Realm authority they replicate.

### Same Realm

If both sides already carry the same authenticated `realm_id` and Authority
Binding history, the coordinator adds the node enrollment and ordinary
reconciliation begins.

### One empty side

An empty profile may adopt the populated side's Realm identity. Any unused local
bootstrap namespace and writer stream are retired before portable records exist.
No resource identity migration is needed.

### Two populated, different Realms

Linking does not silently merge them and synchronization does not invent special
conflict rules. The user is shown an explicit **Join Personal Realms** operation:

1. authenticate control of both source and destination Realms;
2. select the destination Realm authority;
3. freeze or fence new source-authority writes at a durable checkpoint;
4. append an authenticated migration record that transfers the source namespaces'
   Authority Bindings to the destination and retires source writer grants;
5. retain every `ResourceRef`, historical `BatchRef`, causal relationship, and
   source-authority record; and
6. begin the ordinary reconciliation function after the identity transition
   commits.

The linked hub Realm is the default destination when it already coordinates other
replicas, because that minimizes re-enrollment. This is an operational default,
not a claim that the hub is the canonical physical home. If only the local side is
populated, the hub adopts the local Realm instead.

The user may cancel and keep separate profiles or use explicit copy/export
workflows. A partial join cannot expose a half-migrated authority: it is resumable
or rolls back before the new Authority Binding becomes visible. Exact transaction
and recovery mechanics remain a focused migration design.

This preserves the earlier synchronization rule. First and later synchronization
use one reconciliation function. Realm join is an explicit identity/authority
operation that establishes its precondition, not an import mode hidden inside
first sync.

## 6. Authority Connections

An Authority Connection is local broker state with at least:

```text
connection_id
authenticated authority_id and issuer
authority-local subject reference
broker node_id
credential reference
granted scopes and capabilities
connection and reauthentication status
policy and permitted mount modes
```

The authority ID is established through authenticated metadata, not copied from a
resource payload. The issuer, endpoint set, and key material are pinned to that
connection and may change only through an authenticated transition. Explicit
server URLs, QR/deep links, and ordinary OAuth/OIDC discovery are sufficient for
initial delivery; a global DID, Nostr, or OpenID Federation trust mesh is not.

One profile may authenticate twice to the same authority as different subjects.
The connections remain distinct. A mount names one connection and one exact
`ResourceRef`; model-facing retrieval and tools receive the resulting authority,
subject/grant, revision, and policy provenance rather than an ambiguous authority
default.

Non-secret mount descriptors may synchronize through the Personal Realm when the
foreign authority permits it. On a replica without the credential or a reachable
broker, the UI and model see that mount as unavailable or requiring local
authentication. Credentials never hitchhike with the descriptor.

Public read-only Git sources may need no account connection. Their configured Git
or forge adapter still supplies source identity, freshness, and update behavior;
public access is not a reason to pretend the source belongs to the Personal Realm.

## 7. Writer Grants

A Writer Grant is an authority-authored, immutable or revisioned authorization
record. Conceptually it names:

```text
grant_id
authority_id and authority revision
author_stream_id
authorized principal or principal class
resource namespace/resource scope
allowed resource kinds and typed operations
online/offline authoring mode
validity and revocation state
```

The batch references the grant and author stream, but the receiver obtains the
acting principal from authenticated transport or retained origin proof. A caller
cannot escalate by substituting another `grant_id` or stream in the payload. The
authority validates that the principal may exercise that grant against the exact
Authority Binding revision targeted by the operation.

Initial authoring modes are:

- **online authority:** the authority validates and commits the operation now;
- **offline candidate:** the stream may preserve a signed or attributable
  candidate, but the authority must accept it before it advances shared state; and
- **offline peer:** the stream may author specified Personal Realm records that
  peer reconciliation can accept under typed conflict rules.

Foreign shared resources default to online authority or offline candidate.
Offline peer authorship is initially reserved for the Personal Realm. A grant is
resource- and operation-scoped: permission to append a Chat message does not grant
permission to change membership, persistent policy, deletion retention, or an
accepted Knowledge Space ref.

Writer grants and author streams are not bearer secrets. Private keys and tokens
prove which principal is using them. Historical grants and batches remain
inspectable after expiry or revocation so audit and causal history do not change
retroactively.

## 8. Credential and delegation boundary

Each broker keeps refresh credentials in its platform-appropriate secret store.
Access tokens are short-lived and audience-restricted to the intended resource
server. Sender-constraining them to the broker key is preferred when supported.

For a remote executor, the broker chooses one of two paths:

1. proxy the exact typed operation and keep all upstream credentials local; or
2. exchange or mint a short-lived delegation bound to the authority, subject,
   exact resource/action, executor identity, audience, and expiry.

The delegation records both the user/subject and acting executor. It is not
invisible impersonation, and it cannot be exchanged for a broader refresh token.
If an upstream only supports broad bearer tokens, proxying is safer than copying
one to the executor.

Inference providers follow the same rule. A hub may proxy a model call without
revealing its upstream key. A personal node may use its own provider directly.
Workspace information-flow policy separately decides whether content may leave
the node; hiding the credential does not make data egress local.

## 9. Revocation and failure

### Personal node unlink

Unlink requests hub-side revocation of the node principal, renewable link
credential, and active writer grants, then removes local enrollment secrets. If
the hub is unreachable, the node reports a local disconnect but not completed
revocation. Local data and standalone operation remain.

### Foreign connection removal

The broker invokes upstream token revocation when supported, deletes local
credentials, and marks its mounts unavailable. It does not delete upstream
resources or copies already retained under explicit policy.

### Writer-grant revocation

The authority records a new grant or Authority Binding revision. Online operations
from the retired stream fail immediately. Historical accepted batches remain
valid history.

An offline node may have authored work without observing revocation. Unless the
authority can prove it falls before an accepted cutoff, that work cannot silently
advance shared state. It remains a visible candidate/fork at the source and may be
explicitly reauthorized or copied after the node authenticates again. This
preserves work without converting revocation uncertainty into authority.

Revocation is not remote wipe and cannot prove deletion of a key on a lost device.
Key recovery, identity-preserving rotation, multi-peer revocation propagation,
and verifiable offline cutoffs remain later security designs.

## 10. Scenario checks

### Standalone CLI links to an existing web account

The device flow authenticates the account and node key. If local and hub Realms
are both populated and distinct, the UI asks for Realm join; it does not run an
opaque “merge.” Once the Authority Binding transition commits, the same ordinary
sync reconciles both corpora. The CLI keeps local operation and its current
directory remains its only automatically advertised Workspace.

### Phone uses a work mount brokered by the hub

The Android profile carries the non-secret work mount descriptor but no work
refresh token. It routes an exact read or write through the hub broker. If the hub
is unavailable, the mount is shown unavailable; it is not replaced by an empty
result or silently attempted under a family credential.

### Leo, his wife, and children share family resources

Each profile authenticates as its own family-authority subject and mounts the same
family `ResourceRef` values. Leo's work connections and his wife's work
connections remain separate. Children may have family and school connections.
The shared UI is a union of mounts, not a global person/account merge.

### A desktop node is remotely revoked while offline

The hub stops accepting its tunnel, sync, and writer credentials. The desktop may
continue standalone because it has not observed the revocation. Its later batches
remain local candidates until a new authenticated flow explicitly decides their
fate; another replica does not accept them merely because their UUIDs are unique.

### Workspace Run uses a managed model

The executor sends a brokered model operation or a narrow delegation. It never
receives the hub's reusable provider key. The Workspace egress policy still has to
allow the prompt and attachments to reach that provider.

## 11. Implications for the current repository

This decision causes no immediate auth, schema, or API change:

- the current hub session remains the trusted source of `user_id` and RLS scope;
- `external_identities` remains an ingress map from a provider subject to one hub
  user, not a multi-authority connection registry;
- operator provider-secret references in `llame.config.json` remain local to the
  current installation;
- no generic token broker, Writer Grant table, DPoP layer, or Realm migration
  endpoint is scaffolded before a focused capability needs it; and
- future Node Protocol operations derive the principal from their authenticated
  channel and accept resource/grant references only as targets to reauthorize.

The first concrete connection slice should be one end-to-end relationship, not a
generic federation platform. The likely smallest proof is explicit personal-node
enrollment with no foreign authority mounts, followed later by one online-only
foreign mount.

## 12. Evidence from existing standards

OAuth provides useful mechanics without supplying llame's resource or Realm data
model:

- the Device Authorization Grant supports a CLI or constrained device completing
  authorization through another user agent;
- DPoP sender-constrains access and refresh tokens to proof of a client key, while
  explicitly remaining insufficient by itself for access control;
- Resource Indicators let a token request name its intended protected resource so
  issued tokens can be audience-restricted;
- Token Exchange can produce a narrower delegated token but does not automatically
  propagate later revocation; and
- Token Revocation defines an upstream invalidation request but cannot erase
  already retained resource data or prove deletion on a device.

Sources:

- [OAuth 2.0 Device Authorization Grant](https://www.rfc-editor.org/rfc/rfc8628.html)
- [OAuth 2.0 Demonstrating Proof of Possession](https://www.rfc-editor.org/rfc/rfc9449.html)
- [OAuth 2.0 Resource Indicators](https://www.rfc-editor.org/rfc/rfc8707.html)
- [OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693.html)
- [OAuth 2.0 Token Revocation](https://www.rfc-editor.org/rfc/rfc7009.html)

These standards are selected as implementation candidates at their narrow seams,
not as a requirement to expose OAuth everywhere or adopt global identity
federation.

## 13. Deliberate deferrals

This decision does not yet choose:

- exact enrollment, connection, grant, or migration wire schemas;
- the DPoP, mTLS, local-IPC, key-store, and token-storage implementation per
  platform;
- Realm-join checkpoint, rollback, and multi-replica quiescence mechanics;
- writer-stream cutoff proof after offline revocation;
- identity-preserving node-key rotation or recovery;
- automatic authority discovery or multilateral trust chains;
- offline replication of foreign shared resources; or
- provider-specific delegation adapters.

## 14. Next architectural decision

The next dependency is the **execution placement and authority state machine**.
Resource identity, current Authority Bindings, enrolled node principals, writer
grants, and brokered credentials now provide the nouns needed to specify safe
handoff, fallback, recovery, and remote control without making the hub a second
executor.

## 15. Promotion boundary

This note records the trust and credential direction. `VISION.md` owns the durable
principles. `SPEC.md`, OpenSpec, ROADMAP, and the shipped authentication system
remain unchanged until a focused capability is selected.
