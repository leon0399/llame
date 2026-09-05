# Cross-authority information flow and derived data

- **Status:** selected vision direction; not a shipped contract
- **Date:** 2026-08-22
- **Confidence:** high for destination-first, sink-gated flow and conservative
  derivation; moderate for future declassification UX

## 1. Decision

Every Chat branch and Run has one declared **destination authority** before llame
persists assistant output or authority-scoped context. Every system-mediated source
observation carries trusted provenance and policy metadata outside model-controlled
text. Before the observation reaches a model, tool, executor, Workspace, store,
replica, log, or external service, the harness checks that exact sink.

When several sources contribute, provenance accumulates and permitted sinks
narrow. The effective policy is the intersection of every source constraint, the
destination's acceptance policy, current access grants, Workspace and node policy,
and the requested executor/model/tool capabilities. A public or permissive source
never relaxes a restrictive one.

Model output, summaries, compaction checkpoints, embeddings, memories, indexes,
artifacts, and tool inputs derived from restricted context inherit its provenance
and effective restrictions. Transformation is not declassification. A model
cannot assert that output is safe to export, and deleting or compacting the source
text does not reset the policy history of a context that already observed it.

If no common sink is authorized, llame excludes the incompatible source, moves to
an eligible executor/model, offers a branch under the appropriate authority, or
runs separately isolated branches. It does not silently blend the sources and ask
for forgiveness at write time.

## 2. The trusted flow envelope

Each retrieved or mounted observation is accompanied by metadata at least
equivalent to:

```text
source authority_id
source ResourceRef and exact revision
authenticated subject or Writer Grant reference
policy revision and freshness or lease
allowed processing locations and executor classes
allowed model, tool, network, and presentation sinks
allowed persistence, replication, and export destinations
derived-output and retention requirements
```

This is conceptual shape, not a selected wire schema. A trusted adapter binds
policy authenticated from the governing authority or applies a restrictive local
default, and may add stricter Workspace or node policy. It cannot mint a
permissive foreign policy. The resulting metadata is bound to the retrieved
revision. It is not parsed from document frontmatter, prompt text, MCP output,
model output, client-supplied headers, or a caller-selected `authority_id`.

Untrusted content can describe a fake policy or instruct the model to ignore one;
neither changes the envelope. A relay may forward the envelope and data without
becoming their author or policy authority.

Policy identity and data identity remain separate. A new policy revision may
govern future use of an unchanged resource revision. A cached authorization lease
may expire even when the bytes remain present. Evaluation records both the data
revision and policy/freshness evidence used for the decision.

## 3. Alternatives considered

### A. Check permission only when the model writes

Let all readable sources enter one context and authorize only final persistence or
tool calls.

**Strength:** simple retrieval and maximum model context.

**Failure:** sending source text to an executor or inference provider is already a
flow. The model may quote it in output, hide it in a summary, or include it in a
tool request before the final write check. Authorization after exposure cannot
undo exposure.

**Decision:** rejected.

### B. Universal byte-level taint tracking

Label every byte across models, shell processes, files, databases, network calls,
and arbitrary third-party tools with a formal lattice.

**Strength:** a strong theoretical boundary if every component and covert channel
participates correctly.

**Failure:** llame cannot truthfully provide that guarantee across arbitrary
models, native coding agents, shells, MCP servers, browser surfaces, or user-owned
operating systems. Pretending otherwise would make the security claim broader than
the enforcement surface.

**Decision:** rejected as the product contract. Sandboxes and network controls may
strengthen specific paths later.

### C. Keep every authority in a permanently separate Run

Never combine work, family, personal, school, or public observations.

**Strength:** simple isolation and clear storage ownership.

**Failure:** it deletes the main value of a federated assistant: policy-permitted
cross-domain reasoning. It also cannot handle an explicit, authorized absorption
or comparison workflow.

**Decision:** retained as the safe fallback when policies have no common sink, not
the universal UX.

### D. Destination-first Runs with labeled observations and sink gates

Select the durable destination, carry trusted metadata with system-mediated
inputs, evaluate before each exposure, and conservatively propagate restrictions
through derived output.

**Strength:** enforceable at llame-owned boundaries, compatible with local and
remote executors, supports authorized combinations, and fails closed before
disclosure.

**Cost:** a mixed-authority Run may be forced onto a narrower executor or split;
provenance sets and context policy must survive compaction and handoff.

**Decision:** selected.

## 4. Destination-first branch semantics

The destination authority answers: “Who governs the durable result of this branch
and its episodic history?” It is not necessarily the authority that executes the
Run, brokers inference, owns the user identity, or supplied every source.

Examples:

- a normal personal Chat targets the Personal Realm;
- a work-scoped Chat targets the work authority and is only retained or mirrored
  as that authority permits;
- a family knowledge edit targets the family Knowledge Space authority;
- an explicit absorption from one Knowledge Space to another targets the
  destination Space; and
- a local ephemeral operation still declares that it has no durable destination
  and may use only sources that permit that processing mode.

The branch destination is selected before restricted content enters its durable
history. If a personal Chat discovers that required work data cannot be exported
to the Personal Realm, llame offers to continue in a work-scoped branch or answer
without that data. It does not retroactively relabel the existing personal branch.

This does not require all routing decisions before useful execution. A Run may
inherit its branch's destination, inspect public metadata, and learn which source
or Workspace is relevant. It re-evaluates and, when necessary, branches or asks
before the first protected observation crosses into that context.

A same-authority continuation or automatic concurrency fork preserves its stable
lineage. A cross-authority copy creates destination-owned ResourceRefs and records
source provenance; it is an export workflow, not identity-preserving sync. Source
deletion remains a separate action.

## 5. Sinks are explicit

Policy is evaluated against the actual destination, not the vague verb “use.”
Relevant sinks include:

- the executor node and Sandbox that will receive plaintext;
- the inference provider, model endpoint, and any broker in that path;
- an MCP server, shell process, coding-agent adapter, browser, or device API;
- Workspace files, Git repositories, Knowledge Spaces, Chat history, memory, and
  artifact stores;
- other Personal Realm replicas or foreign caches;
- telemetry, traces, logs, crash reports, evaluation datasets, and support
  bundles;
- a user-facing Surface or shared presentation channel; and
- external messages, web requests, publication adapters, and authority exports.

Reading into model context is a sink decision. So is embedding text, generating a
summary, writing a temporary file, attaching command output to a checkpoint, or
sending prompt content through an inference broker. “Temporary” and “encrypted in
transit” do not mean “not disclosed.”

Each adapter declares stable sink identity and capabilities. A user-friendly name
such as “local model” or “work MCP” is not authorization evidence. The trusted
connection and configured endpoint determine the evaluated principal, provider,
location, and policy class.

## 6. Policy composition and approval

Composition is restrictive:

- prohibitions override prompts and allows;
- an `ask` decision overrides ambient allow;
- allowed destination and capability sets intersect;
- retention and freshness limits choose the shortest valid bound; and
- local policy may further restrict foreign authority policy but cannot relax it.

Approval is meaningful only when the governing authority delegated that choice to
the current subject. A user clicking “allow” cannot override a work-authority
deny. A remembered approval may update local or authority policy only within the
delegated scope; otherwise it is scoped to the exact source revisions, destination,
sink, action, and Run incident.

Permission to read a source establishes neither permission to expose it to the
selected model nor permission to store a derivative at the branch destination.
Those are separate sink decisions.

One prompt may summarize several compatible `ask` requirements, but it names:

- which authorities and resources contribute data;
- the exact executor/model/tool or persistence destination;
- whether output will be stored, replicated, or exported; and
- whether the decision is one-time or policy-changing.

Missing, invalid, stale, contradictory, or unevaluable policy fails closed for the
requested flow. The system may still offer a less capable path whose sinks are
provably permitted.

## 7. Derived data is not a laundering boundary

The initial rule is conservative: a derived item carries the union of source
provenance and the intersection of their restrictions. This applies even when the
output contains no verbatim quote.

Examples include:

- assistant answers and reasoning-visible semantic blocks;
- Chat and fork summaries;
- compaction checkpoints and context receipts;
- embeddings, extracted facts, tags, indexes, and knowledge-graph edges;
- generated code, patches, documents, images, and reports;
- tool arguments assembled from model context; and
- cached or normalized versions of a source.

An explicit export may create a new destination-owned resource only when every
source authority permits that destination and any continuing obligations are
representable there. The export retains source provenance and the exact policy
decision. If the source permits use but not persistence, the output cannot be
stored merely because it is paraphrased.

Declassification is a separate authority operation. It may eventually use
source-defined redaction, review, or a subject holding an explicit declassification
grant. An LLM classification or user assertion alone is not sufficient. When the
destination cannot enforce required continuing restrictions, the export is denied
or remains under the source authority.

## 8. Context lifetime and clean boundaries

Once a model execution context has observed a restricted source, later output may
depend on it. Removing the source message from the visible window, summarizing it,
or compacting the Chat does not prove that influence disappeared. The context
checkpoint retains the contributing provenance and effective restrictions.

A clean boundary requires a new execution context whose inputs are proven not to
include the restricted source or its non-declassified derivatives. Valid examples
include:

- forking from an anchor before the source entered context;
- starting a new branch with an independently constructed context receipt; or
- consuming an explicitly declassified artifact instead of the original source.

Reusing an opaque provider session across incompatible policy domains is therefore
an optimization only when the adapter can prove a clean reset. Otherwise the
harness starts a fresh provider context. A handoff carries the policy-bearing
context receipt; it cannot drop labels to make a target eligible.

## 9. Model and tool contract

The model does not evaluate or rewrite the authority policy. It sees only the
sources, tools, destinations, and restrictions the harness made available, plus
concise recorded transitions when availability changes.

Model-facing operations may request intent such as entering a Workspace, reading
a mounted source, calling a tool, or writing to a destination. The trusted harness
resolves the exact ResourceRef, source revisions, sink identity, current grants,
and effective policy, then allows, prompts, denies, or proposes an eligible
alternative.

Before a write-capable external operation, the durable intent and flow decision
are recorded. Its result adds provenance and may add restrictions. An ambiguous
disconnect remains `outcome_unknown`; retry does not bypass the original policy or
pretend the first disclosure did not occur.

A tool's response is re-evaluated before it reaches the model, Chat, logs, or
artifact storage. Permission to send a request does not imply that an unexpectedly
restricted response may enter the current context.

When a source or sink becomes unavailable or newly permitted, the model and UI
receive one meaningful transition. Removed data is no longer injected, but prior
derived context remains governed until a clean boundary.

## 10. Execution, credentials, and Sandboxes

Credential possession and information-flow permission are independent. A broker
may hold a valid work refresh token while the selected executor or model remains
an impermissible sink. A delegated token proves a caller may perform an operation;
it does not authorize every downstream persistence or inference path.

Placement evaluates policy before transferring plaintext. If the current executor
is ineligible, llame may select an allowed node/model, perform the operation at the
source broker and return only permitted output, or split the workflow. Capability
discovery may use non-secret metadata without fetching protected content first.

For arbitrary shell and coding-agent execution, llame cannot trace every byte
through user-owned programs. The enforceable initial boundary treats the Run,
Sandbox, and mounted Workspaces conservatively as exposed to their combined
sources, then gates llame-managed network, model, tool, persistence, and export
paths. Stronger claims require Sandbox isolation and egress enforcement; prompt
labels alone are not a security boundary.

## 11. Freshness, revocation, and failure

Policy evaluation records the authority policy revision, membership/grant state,
and cache or authorization lease used. An `online-only` source requires current
authority validation. An offline-capable source remains usable only within the
retention, lease, and operation mode its authority granted.

If policy or access changes mid-Run:

1. new retrieval and sink operations reauthorize against the current known state;
2. removed sources and tools produce a model/UI availability transition;
3. already exposed context retains its restrictions;
4. pending external operations settle or become `outcome_unknown`; and
5. durable output proceeds only if its destination remains authorized.

Revocation stops future llame-mediated access and flow when observed. It cannot
prove erasure of plaintext already shown to a user-controlled device or exported
under an earlier valid decision. The UI must not claim remote wipe.

## 12. Scenario checks

### Personal question uses work and public knowledge

The branch targets the Personal Realm. Public knowledge permits the destination;
work policy does not. llame either excludes work, asks only if work delegated an
export choice, or opens a work-scoped branch on an approved executor/model. Public
data cannot launder work content into the personal Chat.

### Work and family sources would produce a family document

Writing the family document is an export of every contributing work-derived item
to the family authority. Read access to both sources is insufficient. If work
denies that sink, the combined write is denied even if the family authority would
accept it.

### Workspace uses a hub-brokered model

The hub keeps its provider credential, but the Workspace excerpts still leave the
node. `local-only` blocks the call; `ask-before-upstream-egress` produces an exact
prompt; an allowlist admits only the configured provider/model identity. The
credential boundary does not substitute for the data decision.

### Agent summarizes a work Chat into personal memory

The summary and extracted facts inherit work provenance. Storing them in the
Personal Realm is a cross-authority export and fails unless work policy explicitly
permits it. Calling the output “memory” or “summary” changes nothing.

### Agent absorbs Knowledge Space A into B

The workflow validates read/export permission from A and write/import permission
at B, then creates B-owned content with source provenance. Each candidate and
publication outcome remains explicit. Deleting A is still a separate manual
action.

### Two authorities allow processing but no shared persistent destination

llame may run isolated authority-scoped subflows and present separately authorized
results side by side. It does not synthesize a durable combined answer unless an
explicit destination accepts a permitted export from both.

### Work access expires while a model call is running

The call's original dispatch and policy decision remain audited. Its result is
accepted or discarded according to the recorded grant, the source authority's
cutoff semantics, and any newly required destination check; an ambiguous outcome
is not retried blindly. No later tool or persistence step uses the expired source
without reauthorization.

## 13. Enforcement boundary

llame governs data flows it mediates: retrieval, context construction, model and
tool dispatch, Workspace and artifact writes, synchronization, publication,
memory, logs, and exports. It can make those operations explicit and fail closed.

It cannot stop an authorized human from retyping information, prevent screenshots
on a user-controlled device, prove deletion from arbitrary storage, or observe all
side channels inside an unrestricted host process. Multi-tenant hubs rely on
datastore isolation; mutually untrusted local users require OS, container, or VM
isolation. Product claims and policy UI must stay inside those boundaries.

## 14. Implications for the current repository

This direction causes no immediate prompt, schema, API, auth, tool-policy,
OpenSpec, or roadmap change:

- current hub data remains tenant-scoped under the authenticated user and RLS;
- current operator-managed inference configuration remains installation-local;
- no generic taint lattice, policy DSL, cross-authority context router, or label
  table is scaffolded;
- existing context receipts and model-visible availability transitions remain
  useful seams but do not yet claim multi-authority enforcement; and
- a future multi-authority slice must add negative tests proving that a forbidden
  source never reaches the model/tool/store sink, not merely that the final UI
  hides it.

The smallest proof should use one foreign online-only source and one explicit
destination/model sink. Do not begin with a universal ABAC engine or arbitrary
shell taint tracking.

## 15. Deliberate deferrals

This decision does not choose:

- an exact policy schema, expression language, or administrative UI;
- authority policy signing, distribution, cache, and revocation wire formats;
- provider, executor, tool, or location identity taxonomy;
- declassification workflows and reviewer roles;
- encrypted computation, hardware enclaves, or information-flow-aware operating
  systems;
- semantic detection of user-pasted protected information;
- fine-grained byte provenance inside arbitrary processes;
- cross-authority audit export and retention mechanics; or
- provider-specific no-training, regional-processing, or data-retention claims.

Those require focused threat models and verifiable integrations. They are not
implicitly solved by labels.

## 16. Next architectural decision

The next federation dependency is **independent upgrade and schema-evolution
compatibility**. Offline nodes and foreign authorities will reconnect with older
protocol, resource, and policy revisions. The system needs an honest boundary for
negotiation, unknown semantic operations, snapshots, writer cutovers, and
read-only degraded modes before wire schemas are frozen.

## 17. Promotion boundary

This note records a vision architecture decision. `VISION.md` owns the durable
principles. `SPEC.md`, OpenSpec, ROADMAP, and the shipped runtime remain unchanged
until a focused capability is selected.
