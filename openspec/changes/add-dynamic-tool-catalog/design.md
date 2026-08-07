## Context

See `proposal.md — Why` for motivation, and
`docs/research/tool-harness/2026-08-07-214-harness-audit.md` for the evidence
behind each decision below, including how four peer harnesses resolved the same
questions.

Three facts about the current implementation shape everything here:

1. **The declaration path is already JSON-Schema-driven.** Snapshots persist
   `ModelToolDeclaration { id, description, inputSchema: JSONSchema }`, the run
   loop builds its toolset from those declarations, and compaction builds
   schema-only declarations the same way. The Zod coupling is confined to the
   executor side: the `Tool` type's `inputSchema`, the runner's argument
   validation, and the snapshot rebind that reconstructs a JSON Schema from the
   executor's Zod schema to compare against the snapshot.
2. **The context boundary already excludes tool payloads.** The context builder
   projects visible text only and drops tool-role rows, and compaction consumes
   that same builder. The spec requirement added for this boundary is therefore
   mostly a characterization of existing behavior — the work is tests, not a new
   stripping layer.
3. **The abort path settles nothing.** Verified against the run-event translator:
   `tool.requested` opens a tool part, `tool.started` emits nothing, and
   `run.cancelled` emits only `finish`. The terminal handlers close open text and
   reasoning parts but not tool parts. Persistence goes the other way and filters
   unsettled tool entries out of the assistant message.

## Goals / Non-Goals

**Goals:**

- One catalog abstraction that is exercised by more than one source before #215
  arrives, so it is not an untested generalization.
- Contract decisions (id form, boot validation, drift policy) settled here so
  #215 and #213 are additive rather than reopening them.
- Every design choice that costs little now and much later — schema shape,
  redaction seam, origin metadata — taken now.

**Non-Goals:**

- Any transport, connection lifecycle, discovery protocol, or credential handling.
  Those are #215's and this change must not anticipate their shape beyond the
  reserved id namespace and the "source is declared in configuration" hook.
- Result-size policy driven by the model's context window. The truncation
  corruption defect is #294; the context-derived caps that depend on the widened
  contract here are deliberately deferred rather than bundled.
- Any change to the shipped toolset. `search_conversations` remains the only tool
  an operator can allowlist after this change.

## Decisions

### D1. The catalog is an injected interface; the in-code registry becomes a source

**Decision.** Introduce a catalog abstraction that both snapshot binding and
execution resolve through, with the existing in-code registry as one contributing
source, and a second in-process source contributed by tests.

**Why not keep the registry and special-case dynamic tools.** A second code path
for dynamic tools is exactly what the issue exists to prevent: the two paths drift,
and the security properties (classification gate, allowlist, tenant scoping) then
have to be re-proved on each. One catalog means one gate.

**Alternative considered — defer the abstraction to #215.** Rejected because #213
(`knowledge_search` / `knowledge_read` over a Markdown vault) also depends on this
issue and is not MCP. The catalog has three known consumers, two of which involve
no transport, so it is not a speculative generalization.

### D2. The test fixture is an in-process dynamic tool, not a mock MCP server

**Decision.** The "test dynamic tool" the acceptance criteria call for is a
JSON-Schema-declared, catalog-injected, in-process tool with no transport.

**Why.** A fake MCP server here would be throwaway scaffolding duplicating #215's
own deterministic fixture. An in-process dynamic tool is instead the exact shape
#213 needs, so the fixture previews a real consumer rather than simulating one.
It also keeps this change free of any transport dependency.

### D3. Tool ids use a reserved, provider-legal namespace

**Decision.** Dynamic ids take a reserved prefix and are restricted to
`[A-Za-z0-9_-]` with a bounded length, validated when a source contributes them.

**Why not a colon separator** (`mcp:server:tool`, the intuitive choice). Provider
function names reject it — OpenAI constrains function names to
`^[a-zA-Z0-9_-]{1,64}$`, and the toolset key becomes the function name. This was
verified against peers: opencode sanitizes `[^a-zA-Z0-9_-]` to `_`, and Claude Code
uses `mcp__server__tool`. A double-underscore separator is unambiguous under that
character set and matches the convention users already see elsewhere.

**Consequence.** Validation happens at contribution time, not call time. A tool
that cannot be named cannot be offered, so the failure surfaces where the source is
wired rather than mid-run.

### D4. Boot validation splits by id form

**Decision.** Static ids resolve strictly at boot as today. Namespaced ids validate
only that their source is declared in configuration; the tool resolves later and is
fail-closed until it does.

**Why not keep strict validation** and require operators to declare every dynamic
tool up front. That makes discovery decorative and pushes the same problem into
#215's configuration surface, reopening `instance-config` — which is precisely what
this issue is supposed to prevent.

**Why not make boot await discovery.** It converts an offline remote source into a
startup failure, contradicting the requirement that an unavailable source degrade
only its own tools.

**Trade-off accepted.** A typo inside a namespaced id is no longer caught at boot;
it surfaces as an unavailable tool. Mitigated by failing boot when the _source_ is
undeclared, which catches the common typo class, and by reporting unresolved
allowlisted ids rather than silently ignoring them.

### D5. Declaration drift withdraws the tool, not the run

**Decision.** A bound declaration that no longer matches its live catalog entry
withdraws that tool for the turn, records the withdrawal as durable run activity,
and lets the run continue on the remaining tools.

**Why the current fail-the-run behavior is wrong going forward.** It is right for an
in-code registry, where drift means a redeploy landed mid-run. For a source that can
legitimately re-advertise a changed schema, it converts one upstream edit into
failures across unrelated runs — the opposite of degrading only that source's tools.

**Why record it.** The snapshot receipt is an immutable claim about what was
advertised. Withdrawing a tool makes that claim locally untrue for the turn, so the
divergence must be visible rather than silent.

**Why no TTL on a withdrawal.** A timer would silently re-advertise a tool whose
declaration still does not match. Availability returns only when a live entry
matches the bound declaration. This mirrors openclaw's quarantine, which
deliberately has no TTL and lets process liveness own expiry.

### D6. Canonicalization is defined once and shared

**Decision.** One canonicalization routine serves snapshot-time hashing and
bind-time comparison, for both schema kinds, with JSON-Schema-native tools compared
without a round-trip through the code-schema conversion.

**Why.** Today the rebind reconstructs a JSON Schema from the executor's schema and
demands byte-equality with the snapshot. For a tool whose schema is already JSON
Schema, that round-trip can perturb the document and manufacture drift that never
happened — turning D5's withdrawal into a false positive on every run.

### D7. Replay safety is a second axis, not more enum values

**Decision.** Add a replay-safety dimension to the tool contract, separate from the
SPEC §13.5 safety classification.

**Why not extend the classification enum.** The two questions are orthogonal: §13.5
answers how dangerous an action is, replay safety answers what happens if it runs
twice. Two `read_only` tools can differ on the second question. Encoding both in one
enum multiplies its values and makes the §13.5 vocabulary — which SPEC owns —
answer a question it was not defined for.

**Why now, with no write tools.** The tool record is about to be persisted into
immutable snapshots. After #215 every added field is a snapshot-format change. The
shipped spec already carries a write-tool landmine requirement waiting for exactly
this dimension.

### D8. Redaction is a write-path concern, not a logging concern

**Decision.** Apply redaction where tool activity is persisted and streamed, not
only where it is logged.

**Why.** Run events are durable, owner-visible, and replayed on every reconnect. The
shipped spec already forbids secrets in recorded results; the gap is that nothing
enforces it and the rule does not cover call arguments. Placing the seam on the
write path means no durable row can hold a secret that later readers are merely
trusted not to look at.

### D9. Untrusted metadata is neutralized where the catalog entry is built

**Decision.** Neutralize externally supplied descriptions and schema prose at
catalog-entry construction, reusing the existing authored-text sanitizer rather than
inventing a second one.

**Why there.** The description flows into the hashed, immutable snapshot and the
owner-visible receipt. Neutralizing at construction means no consumer — hashing,
receipt, provider request — can observe the un-neutralized form, and the hash is
computed over what was actually sent.

**Why reuse the sanitizer.** Its two rules (a value cannot close a boundary it did
not open; a reserved structural name is never emitted) were derived for
owner-authored text facing the same threat. A second implementation would drift from
the first.

### D10. Continuity is measured before any projection is built

**Decision.** Land the boundary characterization tests first. Build a tool
observation projection only if those tests demonstrate a real continuity failure.

**Why not build it up front**, given that all four peer harnesses replay tool
results. Their constraints differ: a coding agent that loses a file-read payload
cannot take its next step, whereas this system's only tool returns conversation
matches that the assistant restates in its answer text. The issue made the
measurement the gate deliberately. The audit's contribution is that the projection's
shape is already designed if the gate opens — provider-neutral, fenced and labelled
untrusted, bounded, and frozen once projected so the replayed prefix stays stable
for prompt caching — not that the gate is pre-opened.

## Risks / Trade-offs

- **The catalog abstraction is shaped by a consumer that does not exist yet
  (#215).** → Two independent non-transport consumers (the in-code registry and the
  in-process dynamic fixture, with #213 following the same shape) exercise it before
  any transport arrives. If #215 still has to change the contract, that is the
  signal this change was specified wrong, and it is a cheap signal to read.
- **Splitting boot validation weakens a fail-loud guarantee.** → Mitigated by
  failing boot on an undeclared source, and by making unresolved allowlisted ids
  reported rather than silent. Accepted deliberately: the alternative couples boot
  to remote availability.
- **Withdraw-on-drift can silently reduce capability**, leaving a run to answer
  without a tool the receipt says was advertised. → The withdrawal is recorded as
  durable run activity naming the tool, so a reader can always reconcile the receipt
  with what executed.
- **Redaction can only catch recognizable secrets** and will not catch an arbitrary
  sensitive value. → It is defense in depth, not a substitute for tools not
  returning secrets. Stated as such rather than over-claimed.
- **This is a large change for one review.** → It is authored as one specification
  and implemented as a stack of separately reviewable branches; the boundary
  characterization tests and the settling work are independently verifiable and do
  not depend on the catalog work.

## Migration Plan

No database migration and no config migration. An instance whose `tools.allowed` is
empty, or names only static ids, behaves exactly as before.

The one behavior change visible to an existing deployment is D5: a declaration
mismatch that previously failed the run now withdraws the tool and lets the run
proceed. Since the only shipped tool is statically registered, a mismatch can only
follow a redeploy mid-run, where continuing without that tool is at least as good an
outcome as failing.

Rollback is per-branch: the settling work and the boundary tests stand alone, and
the catalog work can be reverted without touching them.

## Open Questions

- Which value vocabulary the replay-safety dimension uses (a boolean versus a small
  enum covering idempotent / at-most-once / unknown). Deferrable: the spec requires
  the dimension to exist, be declared, and fail closed when unsafe, and no shipped
  tool exercises more than the safe case yet.
- Whether the withdrawal record is a distinct run-event type or an attribute on
  existing tool activity. Deferrable: the spec requires the withdrawal be durably
  recorded and attributable to a named tool, which either representation satisfies.
