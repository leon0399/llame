# Personal Node runtime and thin terminal

## Motivation

The terminal currently owns the model loop, SQLite, MCP lifetime, and native
execution. That couples every future desktop/daemon surface to terminal code and
leaves standalone conversations without recall or Knowledge reads. Making a
remote account mandatory would hide rather than solve that ownership problem.

## Decision

Make the terminal a client of an independently operable personal Node. Start a
private stdio Node automatically for standalone commands, or attach to an
explicitly running local Unix-socket Node. Keep the existing hosted HTTP client.
Extract and reuse the current runtime, not a second implementation of its loop.
The local Node owns durable state, search, Knowledge access, MCP and permissions.
No account, Postgres, daemon installation, or synchronization prerequisite.

Use the repository research's core/realm/execution/admin module vocabulary for a
versioned local protocol slice. Do not advertise sync or claim hosted protocol
parity; the hosted API remains its existing authenticated REST contract.

Add bounded, literal multilingual episodic recall and live, owner-provisioned
Markdown Knowledge reads. Reuse the API's existing filesystem adapter. Return
source identities and untrusted-data framing; do not load all memory into every
prompt. Knowledge mutation by agents and Git publication are not this cut.

## Threats and exclusions

A local socket is not a network API: private parent directory, private socket,
owner checks, bounded messages, required negotiation, and no caller user ID.
Approvals bind to the requesting connection/action and cannot be supplied by a
model, another observer, or stale/replayed approval. Lost approvers deny; no
side effect is replayed. A persistent Node can outlive its terminal. A transient
stdio child aborts on EOF. Native paths come only from the Node launch grant;
a client cannot select another Workspace or force a sandbox downgrade.

Remote human sessions stay separate in private auth files. Local process
credentials, MCP/provider configuration, filesystem paths and derived indexes
are not Personal Realm state. No enrollment, remote tool proxy, generic database
replication, ChangeBatch journal, Git synchronization, or multiwriter merge is
claimed.

## Delivery

The user explicitly requested brainstorming and implementation in the supplied
bundle. This work is local commits, not a published/approved GitHub proposal or
merge. No GitHub state is modified.
