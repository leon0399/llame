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

### D3. A JSON-Schema tool needs an explicit validator, and one is already installed

**Decision.** Validate JSON-Schema tool arguments server-side with `ajv`, which is
already a direct dependency of `apps/api`.

**Why this is not automatic.** The AI SDK's `Schema.validate` is **optional**, and
`jsonSchema(doc)` leaves it undefined. A JSON-Schema tool therefore gets its schema
sent to the provider — constraining generation — while nothing checks the arguments
that come back. Code-authored schemas validate today only because the runner calls
the schema's own parse. Without an explicit validator, adding JSON-Schema tools would
silently drop server-side argument validation, which the harness owns and must not
delegate to the model's cooperation.

**Why no new dependency.** `ajv` already backs config-schema validation
(`instance-config/schema.ts`). Note the draft mismatch: that call site uses
`Ajv2020`, while the AI SDK types tool schemas as draft-07 — the plain `Ajv` class
from the same package covers it.

### D4. Replay safety is not modelled in this change

**Decision.** Do not add a replay-safety field. Instead, strengthen the shipped
write-tool landmine requirement to name the concrete re-execution path.

**Why not model it**, despite #214 asking for classification and replay safety to be
separated. Nothing can exercise the dimension: every tool in #213, #214, and #215 is
read-only and replay-safe, so the field would have one legal value in practice and
the gate reading it would never fire. A required field with a single possible value
is configuration that documents an intention rather than constraining behavior.

**Why the risk is still covered.** The shipped spec already states that the first
write-capable tool cannot ship without checkpoint-or-dedupe semantics. That
requirement — not a field on a read-only tool — is what stops the hazard. It was
under-specified in one respect, now fixed: it did not say that re-execution is the
_default_ on infrastructure failure. The run queue retries a failed job under its
own policy, and a retried run that is still claimable re-enters the tool loop from
the first step, so a write tool added without dedupe double-applies on any transient
worker failure with no configuration change needed to trigger it.

**Why deferring costs little.** The field would not be snapshot-persisted —
classification already lives outside the snapshot, read from the live registry at
bind time — so adding it alongside the first write tool is a plain field change with
no migration and no format break.

### D5. Continuity is measured in two halves, only one of which can gate

**Decision.** A deterministic unit test asserts **information loss** — a fact present
in a tool result and absent from the assistant's visible text does not reach the next
turn's request. Separately, a model-graded eval under `RUN_MODEL_EVALS=1` asks
whether that loss degrades the answer; it is run once by hand and its outcome
recorded.

**Why the split.** The measurement as originally written was unrunnable. A fake model
cannot demonstrate needing facts it lacks — it returns scripted output regardless —
so a unit test with a stubbed model proves nothing about continuity. A real model
makes it model-graded, which in this repo belongs in `evals/` and is never run by CI,
so it cannot be an acceptance gate. Splitting separates the question that can be
enforced forever from the question that needs judgement once.

**What each proves.** The deterministic half is the durable contract: it fails if a
future change starts replaying tool payloads, which is exactly the regression worth
guarding. The eval half answers whether the loss matters, which is what #215 actually
needs inherited.

**Why build no projection here**, given that all four peer harnesses replay tool
results. Their constraints differ: a coding agent that loses a file-read payload
cannot take its next step, whereas this system's only tool returns conversation
matches the assistant restates in its answer text. The audit already records the
projection's shape if the eval comes back "insufficient" — provider-neutral, fenced
and labelled untrusted, bounded, and frozen once projected so the replayed prefix
stays cacheable.

### D6. Settlement is idempotent per call, first writer wins

**Decision.** A tool call is settled at most once. A late result arriving after
termination already settled that call is discarded.

**Why it needs stating.** The assistant part collector appends a **new** part when it
sees a `toolCallId` with no pending slot, so a tool that ignores cancellation and
completes after settlement would put two records for one call into the persisted
message. Cooperative cancellation is best-effort by definition, so this race is
expected rather than exotic.

**Why first-writer-wins rather than last.** Both records are true — the user
cancelled, and the tool finished anyway — but only one is consistent with the run's
terminal state. Preferring the settlement keeps the message agreeing with the run,
and avoids a result appearing under a run the user was told was cancelled.

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

### D7. A cancelled call needs its own presentation, not an error badge

**Decision.** Keep the persisted part on the SDK's `output-error` state for
compatibility, and extend the shared `ToolHeader` so a termination settlement renders
as cancelled with neutral styling rather than a red error badge.

**Why it cannot be left alone.** `ToolUIPart["state"]` has seven values and none means
cancelled, while the stream bridge maps every structured error result to
`output-error` — rendered as a red ✗ labelled "Error". A user who cancelled their own
run would be told something failed. That would make the "distinguishable from a
genuine failure" property hold in the durable record and nowhere the reader can see
it, which is not what the requirement is for.

**Alternatives rejected.** `output-denied` is visually calmer but says "Denied", and
nothing denied the call. Leaving the error badge and explaining inside the
collapsible body puts the correction behind a click, after the alarming signal has
already been read.

## Risks / Trade-offs

- **Deferring the boot-validation split means #215 touches `instance-config`.** →
  Accepted. The decision above is what prevents re-litigation; the twenty lines that
  implement it are not cheaper to write before the consumer exists.
- **Not modelling replay safety leaves #214's "model classification and replay safety
  separately" unsatisfied by a field.** → Satisfied instead by the strengthened
  landmine requirement, which is what actually gates the hazard. If a reviewer wants
  the field, it is one property and one registration check, and nothing else in this
  change depends on its absence.
- **The continuity measurement may come back "insufficient"**, making #215 carry
  projection work it did not plan for. → Better than building a projection this
  change cannot justify. The shape is already designed in the audit.
- **The deterministic continuity test measures information loss, not usefulness.** →
  Stated as such. It is a regression guard, and the eval is what answers whether the
  loss matters. Neither is presented as doing the other's job.

## Migration Plan

No database migration (`run_events.event_type` is text, not an enum), no config
migration, no change to the shipped toolset. An existing deployment sees one
behavior change: a run cancelled mid-tool now records the call as cancelled instead
of dropping it.

Rollback is per-branch. Groups 1 and 2 stand alone and can be kept if the rest is
reverted.

## Open Questions

None. Both previously open questions are closed: replay-safety vocabulary is moot
now that the dimension is not modelled here (D4), and how a withdrawal is represented
goes with withdrawal itself to #215.
