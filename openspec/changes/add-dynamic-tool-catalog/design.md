## Context

See `proposal.md — Why` for motivation, and
`docs/research/tool-harness/2026-08-07-214-harness-audit.md` for the evidence behind
each decision, including how four peer harnesses resolved the same questions.

Four facts about the current implementation shape everything here:

1. **The declaration path is already JSON-Schema-driven.** Snapshots persist
   `{ id, description, inputSchema: JSONSchema }`, and the run loop and compaction
   both build their toolsets from that. The code-schema coupling is confined to the
   executor side.
2. **The injection seam already exists.** `resolveBoundExecutableTools` takes its
   registry as a defaulted parameter, and `resolveAdvertisedTools` takes its
   candidate source the same way. Both sides are already substitutable; callers
   simply pass the default.
3. **The context boundary already excludes tool payloads.** The context builder
   projects visible text only and drops tool-role rows, and compaction consumes that
   same builder.
4. **The abort path settles nothing.** Verified against the run-event translator:
   `tool.requested` opens a tool part, `tool.started` emits nothing, and
   `run.cancelled` emits only `finish`. Persistence goes the other way and filters
   unsettled tool entries out of the assistant message.

## Goals / Non-Goals

**Goals:**

- Make a JSON-Schema-declared tool executable, which is what #213 and #215 both
  actually need from this issue.
- Fix the two defects that are real today: unsettled tool activity on termination,
  and a comparison that will manufacture drift the moment (1) lands.
- Record the contract decisions the consuming changes would otherwise re-litigate,
  without implementing them before a consumer exists.

**Non-Goals:**

- Any transport, connection lifecycle, discovery, or credential handling.
- Anything whose only consumer is a tool sourced from outside this codebase. See
  "Decided now, implemented in #215" below.
- Result-size policy. The truncation defect is #294.
- Any change to the shipped toolset. `search_conversations` remains the only tool an
  operator can allowlist.

## Decisions

### D1. No catalog abstraction is introduced

**Decision.** Keep the existing defaulted-parameter injection seam. Do not add a
catalog service, interface, or registry abstraction.

**Why.** Both resolution points already accept a substitutable source. An interface
with one implementation, wrapped in dependency injection, would replace a working
parameter with ceremony and would still have exactly one implementer until #215.
When a second source exists, it passes through the seam that is already there.

**Alternative considered — build the catalog now** so #215 is additive. Rejected:
#215 has to wire its source into that seam either way, and a seam invented without
its consumer is a guess. The parameter already provides the substitution point that
the abstraction would have provided.

### D2. Schema comparison must not round-trip

**Decision.** Compare a bound declaration against its live tool without converting a
schema that is already JSON Schema into another representation and back.

**Why.** The current rebind reconstructs a JSON Schema from the executor's
code-authored schema and demands byte-equality with the snapshot. For a tool whose
schema is natively JSON Schema, that round-trip can perturb the document and report
drift that never happened — and drift currently fails the whole run. This is the one
bug that JSON-Schema support creates, so it is fixed in the same change that creates
it.

**Consequence.** With comparison correct, drift can only mean a redeploy landed
mid-run, where failing the run remains the right answer. That is why
withdraw-on-drift is deferred rather than built here.

### D3. Replay safety is a required flag, not an enum

**Decision.** Tools declare replay safety as a required boolean alongside their
§13.5 classification.

**Why a separate dimension.** The two questions are orthogonal: classification
answers how dangerous an action is, replay safety answers what happens if it runs
twice. Two `read_only` tools can differ, and run retries are real — pg-boss retries
a failed job, and a retried run whose claim still succeeds re-executes its tool loop
from the start.

**Why a boolean rather than a vocabulary.** The field is not persisted into the
snapshot — classification already lives outside it, read from the live registry at
bind time — so widening it later is a plain field change with no migration and no
format break. An enum distinguishing idempotent from at-most-once has no consumer
that can exercise it: no shipped or planned tool in #213, #214, or #215 is
non-read-only. Model the distinction when a tool needs it.

**Requested, not inferred.** #214 asks for classification and replay safety to be
modelled separately. Absent that, the shipped spec's write-tool landmine requirement
would already cover this and the field would be YAGNI.

### D4. Continuity is measured, not designed around

**Decision.** Land the boundary characterization tests and the continuity
measurement. Build no observation projection in this change.

**Why not build it**, given that all four peer harnesses replay tool results. Their
constraints differ: a coding agent that loses a file-read payload cannot take its
next step, whereas this system's only tool returns conversation matches the
assistant restates in its answer text. The issue made the measurement the gate
deliberately.

**What the measurement buys.** #215 inherits an answer rather than the question, and
the audit already records the projection's shape if the answer turns out to be
"insufficient" — provider-neutral, fenced and labelled untrusted, bounded, and
frozen once projected so the replayed prefix stays cacheable.

## Decided now, implemented in #215

Each of these is necessary only once a tool arrives from outside this codebase. The
decision is recorded here so the consuming change implements rather than
re-litigates it; none is built now.

- **Dynamic tool ids use a reserved, provider-legal namespace** (`mcp__server__tool`
  form). Not a colon separator: providers constrain function names to
  `[A-Za-z0-9_-]`, and the toolset key becomes the function name. Verified against
  opencode, which sanitizes to that character set, and Claude Code, which uses the
  double-underscore form.
- **`tools.allowed` boot validation splits by id form.** Static ids resolve strictly
  at boot as today; a namespaced id validates only that its source is declared, and
  the tool is fail-closed until it resolves. Neither keeping strict validation
  (which makes discovery decorative) nor awaiting discovery at boot (which turns an
  offline source into a startup failure) is acceptable.
- **Declaration drift withdraws the tool, not the run** — but only once drift can
  legitimately mean "an upstream source edited its schema". Until then D2 makes
  drift mean "a redeploy landed mid-run", where failing loud is correct.
- **Tool payloads are redacted on the persistence path**, covering call arguments as
  well as results. No shared redaction helper exists in this codebase yet, and the
  threat — a remote server echoing a credential into an error body — arrives with
  the remote server.
- **Externally supplied tool descriptions and schema prose are neutralized** where
  the catalog entry is built, reusing the existing authored-text sanitizer. This is
  no cheaper now than later: it changes a string's value, not the snapshot format.

## Risks / Trade-offs

- **Deferring the boot-validation split means #215 touches `instance-config`.** →
  Accepted. The decision above is what prevents re-litigation; the twenty lines that
  implement it are not cheaper to write before the consumer exists.
- **A required replay-safety flag with only safe values is unexercised.** → It costs
  one field and one registration check, it is explicitly requested by the issue, and
  the gate it feeds is tested with a deliberately-unsafe fixture tool.
- **The continuity measurement may come back "insufficient"**, making #215 carry
  projection work it did not plan for. → Better than building a projection this
  change cannot justify. The shape is already designed in the audit.

## Migration Plan

No database migration (`run_events.event_type` is text, not an enum), no config
migration, no change to the shipped toolset. An existing deployment sees one
behavior change: a run cancelled mid-tool now records the call as cancelled instead
of dropping it.

Rollback is per-branch. Groups 1 and 2 stand alone and can be kept if the rest is
reverted.

## Open Questions

None. The two previously open — replay-safety vocabulary and how a withdrawal is
represented — are resolved by D3 and by deferring withdrawal to #215 respectively.
