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
3. **The context boundary excludes tool payloads today, and this change reverses
   that.** The context builder projects visible text only and drops tool-role rows,
   and compaction consumes the same builder — so a round's tool activity is durable
   for display and audit but invisible to every later turn. D5 replaces that with a
   bounded projection.
4. **The abort path settles nothing.** Verified against the run-event translator:
   `tool.requested` opens a tool part, `tool.started` emits nothing, and
   `run.cancelled` emits only `finish`. Persistence goes the other way and filters
   unsettled tool entries out of the assistant message.

## Goals / Non-Goals

**Goals:**

- Make a JSON-Schema-declared tool executable, which is what #213 and #215 both
  actually need from this issue.
- Fix the three defects that are real today: unsettled tool activity on termination,
  tool observations that do not survive the turn boundary while the UI shows them to
  the reader, and a comparison that will manufacture drift the moment (1) lands.
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
that issue has to wire its source into that seam either way, and a seam invented
without its consumer is a guess. The parameter already provides the substitution
point that the abstraction would have provided.

### D2. Schema comparison must not round-trip

**Decision.** Compare a bound declaration against its live tool without converting a
schema that is already JSON Schema into another representation and back.

**Why.** The current rebind reconstructs a JSON Schema from the executor's
code-authored schema and demands byte-equality with the snapshot. For a tool whose
schema is natively JSON Schema, that round-trip can perturb the document and report
drift that never happened — and drift currently fails the whole run. This is the one
bug that JSON-Schema support creates, so it is fixed in the same change that creates
it.

**The comparison algorithm.** Equality is canonical, not byte-wise: canonicalize both
sides by recursively sorting object keys, changing nothing else, then compare. Key
order and other insignificant serialization differences are not drift; any content
difference is. The same canonicalization runs when the snapshot is written and when
it is compared, so the two representations cannot disagree — that shared routine is
the fix, not a second comparison path for JSON-Schema tools.

**Dialect — accept what sources ship, validate under what they declare.** An earlier
draft of this decision pinned draft-07 and refused any declaration naming another
`$schema`. That was wrong. External sources author their own schemas; MCP servers in
particular ship whatever their author wrote, frequently with no `$schema` at all.
Refusing a working tool over a metadata string imposes a constraint on something this
codebase does not control, and contradicts the posture that upstream quirks should
degrade narrowly.

The concern behind the original rule was real — validating a 2020-12 schema under
draft-07 rules silently changes what keywords like `items` mean — but the fix is to
validate under the schema's _own_ dialect, not to reject it. `ajv@8` ships
`dist/2020` and `dist/2019` beside the default draft-07 constructor. The admission path
normalizes equivalent supported dialect URI forms only for constructor selection; it
does not rewrite the source document. Refusal is reserved for a declaration that cannot
be checked faithfully — either its dialect has no validator or that validator cannot
compile the schema. Admission compiles each declaration before snapshotting it, so one
invalid tool is omitted with an id/dialect diagnostic while valid siblings remain.

**A caveat on `$ref`.** Canonical equality compares documents, so a schema carrying
references compares correctly only when both sides are produced the same way. The SDK's
`zodSchema` helper takes a `useReferences` option — required for recursive schemas via
`z.lazy` — and its reference page notes that "not all language models and providers
support such references". Nothing shipped exercises this: the one code-authored tool has
a flat schema and no caller passes the option. Recorded because a future recursive tool
would make the comparison sensitive to how each side was generated, not because the
equality rule needs changing.

**Consequence.** With comparison correct, drift can only mean a redeploy landed
mid-run, where failing the run remains the right answer. That is why
withdraw-on-drift is deferred rather than built here.

### D3. Supply the SDK a validator for JSON-Schema tools; do not validate alongside it

**Decision.** Pass an `ajv`-backed `validate` function to `jsonSchema()` when building a
JSON-Schema tool, so the SDK's existing tool-call parsing does the validating. Do not
add a second validation step beside it.

**Why a validator is needed at all.** The SDK does validate tool calls —
`doParseToolCall` runs `safeParseJSON`/`safeValidateTypes` against the tool's schema and
throws `InvalidToolInputError` — but `safeValidateTypes` opens with:

```js
if (actualSchema.validate == null) {
  return { success: true, value, rawValue: value };
}
```

A schema with no validator **passes everything**. Zod schemas get one from
`zodSchema()`; `jsonSchema(doc)` leaves `validate` undefined, because the option is
optional. So a JSON-Schema tool would send its schema to the provider — constraining
generation — while nothing checked the arguments that came back. The harness owns
argument validation and must not delegate it to the model's cooperation.

**Why supply it to the SDK rather than validate separately.** `jsonSchema()` accepts
`{ validate }` precisely for this. Filling it means failures flow through the path
already wired up: `InvalidToolInputError`, then `experimental_repairToolCall` or
`onUnavailableToolCall`, which this codebase already handles and records as non-fatal
tool errors. A parallel check inside the runner would duplicate that pipeline, run
after the SDK had already accepted the call, and produce a second error shape for the
same failure.

**The documentation does not warn about this**, which is why it is worth stating rather
than assuming an implementer will notice. The SDK's own `jsonSchema` reference — shipped
inside the installed package at `docs/07-reference/01-ai-sdk-core/25-json-schema.mdx`, so
it is version-matched — lists `validate` as `isOptional: true` and describes only what
that function should return. It never says what happens when it is omitted. The sibling
`zodSchema` page, by contrast, promises a schema "containing both the JSON schema
representation and validation functionality". The helpers are asymmetric in a way only
the source reveals: Zod gives you validation, JSON Schema gives you a document. A reader
of both pages would reasonably assume otherwise.

**Dependency boundary.** `ajv` is already a direct dependency of `apps/api`, backing
config-schema validation (`instance-config/schema.ts`). Note the draft mismatch: that
call site uses `Ajv2020` unconditionally, which is not what tool schemas need: per D2 a
schema is validated under whichever dialect it declares, so the validator is the `ajv`
constructor matching that dialect — plain `Ajv` for draft-07 and for an absent
`$schema`, `Ajv2019`/`Ajv2020` for those. A single fixed constructor would mis-validate
exactly the schemas D2 newly admits, including the `items` semantics D2 flags.

Ajv core does not implement standard `format` semantics. With the deliberately
permissive `strict: false` option it warns and ignores an unknown format, which would
advertise `email`, `uri`, or `date-time` constraints while accepting invalid values.
`ajv-formats` is therefore a direct API dependency and is registered on every selected
constructor before compilation. Custom formats remain unsupported unless explicitly
registered and tested.

**On the runner's existing check.** `runner.ts:120`'s `inputSchema.safeParse(args)` is
documented as defense-in-depth for callers that bypass the SDK. It stays, but must
handle both schema kinds rather than assuming Zod; it is not the primary gate and
should not become one.

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
_default_ on infrastructure failure. The run queue retries a failed **job attempt**
under its own policy. That is distinct from the run reaching a terminal state — a
retried attempt re-enters the tool loop from the first step only while its run is
still claimable, and a run already `failed`, `expired`, or `cancelled` is never
reopened. So a write tool added without dedupe double-applies on any transient worker
failure, with no configuration change needed to trigger it.

**Why deferring costs little.** The field would not be snapshot-persisted —
classification already lives outside the snapshot, read from the live registry at
bind time — so adding it alongside the first write tool is a plain field change with
no migration and no format break.

### D5. Tool observations survive into later turns, in the conventional representation

**Decision.** A round's tool activity is replayed into later turns as the model SDK's
tool-call and tool-result parts — the representation providers expect — rather than
dropped at the turn boundary or flattened into prose. Failed, refused, cancelled and
timed-out calls replay carrying their outcome as the result.

**Why replay at all.** This change originally pinned the current no-replay behavior
and deferred the question to a model-graded eval. Two arguments retired that:

- **The reader can see what the model cannot.** The shipped spec requires the chat UI
  to render tool activity including _the result_. The user is looking at output the
  model has discarded, with nothing signalling the gap. "What was the second result?"
  is the ordinary next turn for a search tool, and today produces a hallucination or a
  silent re-run returning different hits.
- **The boundary was arbitrary.** The loop already replays results _within_ a turn,
  step 2 seeing step 1's result under a step cap of 8. Nothing about the information
  changes at the turn edge; that is merely where `partsToText` runs.

All four audited peers replay tool results. llame was the only one that did not.

**Why the conventional representation rather than text.** An earlier draft of this
decision chose fenced prose inside the flattened message shape, arguing that text
preserved provider portability. **That was wrong, and the codebase says so.** The AI
SDK's `ModelMessage` — the type this code already casts to — carries
`ToolCallPart`/`ToolResultPart` (`AssistantContent`, `ToolContent`), and the SDK is
itself the portability layer, mapping them to each provider's native form. Two
consequences:

- Models are trained on that representation. The same content narrated as prose in an
  assistant message is out-of-distribution and carries no structural signal that it
  came from a tool. That alone is sufficient reason.
- The flattening is a **self-imposed narrowing**, not a provider requirement, and it
  already costs something: `run-execution.service.ts:692` and
  `compaction.service.ts:175`/`:327` cast with `as AiModelMessage[]` because a
  `{ role: 'tool', content: string }` message does not structurally satisfy
  `ToolModelMessage`, which requires array content. Adopting the SDK shape deletes
  those casts rather than adding a mechanism.

**Scope, measured rather than estimated.** `models/model-client.ts` already imports
`ModelMessage` from `ai`, so the model boundary is SDK-typed today. The narrow type sits
between two already-SDK-typed boundaries. The repaired fallback estimator serializes
the exact projected message array instead of counting visible text only. In the pinned
fixture of forty successful calls, each with a 100-character result value, followed by
one six-character user message, the old estimator reported **2 tokens**; the repaired
projection is **22,806 UTF-16 code units / 5,702 estimated tokens**, so a 1,000-token fallback
threshold now triggers. The same fixture lives in `compaction.test.ts`.

**What this makes mandatory.** The point of the conventional representation is to
present the model with what it was trained on — and what it was trained on is the
_pair_, a tool call followed by its result. An unmatched call is not merely rejected by
some providers; it is out-of-distribution, and degrades how the model reads the
surrounding history. The pairing rule therefore follows from the same reason that chose
the representation, and holds regardless of whether a particular provider would
tolerate an unmatched call. Provider rejection is corroboration, not the cause.

Two consequences. Every replayed call must carry a result, and a call that produced
none must carry a **well-formed tool result reporting that outcome** — not an omission,
and not prose narrating an absence, which would be the out-of-distribution shape this
decision exists to avoid. And D6's settlement guarantee stops being a correctness
nicety: settlement is what ensures every call has an outcome available to pair with,
which is why settling is the branch below replay in the stack. opencode's comment,
_"Anthropic/Claude APIs require every tool_use to have a corresponding tool_result"_,
records the provider-side half of a constraint that would bind us anyway. Note that
citation is about a provider family llame cannot currently execute against —
`providerType` is `["openai"]` today — so it corroborates by analogy rather than by
naming a provider in the fleet. The requirement does not rest on it: the trained-shape
argument is provider-agnostic, which is why the rule is stated as holding regardless of
provider tolerance.

**Where the untrusted labelling goes.** Structural distinguishability now comes free
from the representation, exactly as it does for the peers — a replayed result is typed
as a tool result, not as conversation. What remains llame-specific is the explicit
label inside the result content (a typed tool result says "this is tool output", not
"this may be adversarial") and the escape-proofing sanitizer, which no audited peer
has. Both survive the form change; only their location moves.

**Chronology.** Persisted part occurrence order is authoritative. Visible text before a
call is flushed as its own assistant message, followed by the standalone
`assistant(call) -> tool(result)` pair; later assistant text is likewise its own message
after the result. An omission marker is its own assistant message at the earliest
omitted occurrence. Keeping visible text and markers out of assistant-call messages
makes the emitted observation sequence exactly the shape the budget measures; unrelated
answer length neither consumes the tool budget nor causes another observation to be
dropped. The stored shape does not preserve whether consecutive calls were parallel, so
it does not invent a parallel group: consecutive calls are conservatively serialized as
standalone pairs in occurrence order.

**Budget contract.** The units are JavaScript UTF-16 code units (`String.length`), not
bytes, Unicode code points, or an informal "KB": the implementation measures the
complete `JSON.stringify([assistantToolCallMessage, toolResultMessage])` envelope,
including input, call/result identifiers, tool names, the untrusted label, outcome, and
result body. The hard limits are 8,000 code units per pair and 32,000 code units per
stored assistant turn or compacted ledger. The precedence is explicit:

1. never emit an unmatched call or result;
2. obey the hard budget;
3. retain the newest observations;
4. retain payload detail when it fits.

Payload clearing removes both input and result body oldest-first, preserving identity
and outcome, and is accepted only when it makes the serialized envelope smaller. If
irreducible cleared pairs still exceed a limit, the oldest **complete pairs** are
dropped atomically until the envelope fits. One bounded omission count/marker reports
the loss; there is never a marker per dropped pair. For the pinned 220-short-call
fixture, both live replay and the compacted ledger are 31,856 code units and retain 80
matched pairs, omit the oldest 140, and retain the newest call. Adding 10,014 code units
of visible text before and 10,013 after those observations makes the full live sequence
51,951 code units while leaving the measured observation envelope at 31,856. Ledger
omission counts accept only non-negative safe integers and saturate at
`Number.MAX_SAFE_INTEGER`, keeping the marker bounded even for adversarial persisted
state.

**Outcome and compaction state.** New tool activity persists its structured outcome
string (`success` or the runner's exact error type), rather than reconstructing it from
human prose. Legacy output errors without the field map to generic `error`; the shipped
`resultProviderMetadata.llame.cancelled` marker remains the only legacy-specific
cancellation recovery. Compaction writes a versioned, runtime-validated v1 JSONB ledger
containing only tool-call identity and outcome. Each normal or model-transition
compaction carries the previous ledger plus newly absorbed observations, already
payload-cleared and re-bounded. Replay order is checkpoint, compacted ledger, then live
window; the cache-aligned compaction request uses the same order. The ledger is internal
state: RLS-scoped with the compaction row and absent from public DTOs, search, and
exports. Provider-native reasoning and metadata, credentials, and unrelated payloads
never replay.

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

### D8. One composed signal owns per-call cancellation

**Decision.** Create one per-call timeout signal and compose it with the trusted parent
run signal. Pass that exact composed signal to the executor and race the executor against
the same signal. A parent signal that is already aborted refuses before argument parsing
or `tool.execute`.

**Why one signal.** Separate timeout signals can fire on different turns of the event
loop: a cooperative executor rejects from the signal it sees while the wrapper checks a
second signal that has not fired yet, misclassifying a timeout as `execution_failed`.
Sharing the signal removes that race while still bounding a tool that ignores it.

**Classification and settlement.** Parent run abort takes precedence over per-call
timeout, which takes precedence over an ordinary executor failure. Per-call abort records
`timeout`. Parent abort synchronously reserves terminal settlement for every open call;
the later cooperative rejection cannot win the existing first-writer guard and cannot
persist `execution_failed`. The terminal run path then records the cancelled or expired
outcome that agrees with the run itself.

The model SDK is not the durability authority: it can resolve stream consumption after
swallowing an asynchronous callback rejection. The queue worker therefore verifies the
owner-scoped Run after every drain and rejects the job while it remains nonterminal.
Both cancel-before-start pickup races use central terminal settlement rather than a
direct status write, so a retried attempt reconstructs any durable open call, settles it,
and only then emits the terminal Run event. A transient settlement-event failure is
retried through that central path; a persistent failure stays nonterminal for queue retry
instead of publishing a false terminal state.

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
- **Not modelling replay safety leaves #214's "model classification and replay safety
  separately" unsatisfied by a field.** → Satisfied instead by the strengthened
  landmine requirement, which is what actually gates the hazard. If a reviewer wants
  the field, it is one property and one registration check, and nothing else in this
  change depends on its absence.
- **Replay changes behavior for every existing chat with tool history.** From the first
  deploy, uncompacted tool history feeds the model more context and can trigger
  compaction earlier. Already-compacted history has a separate limitation: the new
  ledger defaults empty because observations previously absorbed into prose cannot be
  recovered from the summary. → Complete envelopes are hard-bounded per call and per
  turn/ledger; compaction clears payloads and, when necessary, drops oldest complete
  pairs with an omission count.
- **Replayed tool output is untrusted and now persists in context.** Once #215 lands,
  a poisoned remote result would be re-presented on every later turn of that chat. →
  Labelled untrusted in its content — marked as tool output whose instruction-like text
  is not authoritative — escape-proofed by the sanitizer, and bounded. Structural
  identity comes from the representation itself, not from prose delimiters. This is
  injection-**resistant**, not injection-safe: it marks provenance and prevents the
  content escaping its structure, which is not the same as preventing a model from
  obeying text inside it. No audited peer does the labelling or the escape-proofing.
- **The projection is designed against conversation-search rows**, before #215's
  web-search payloads exist. → Accepted deliberately: the user-visible asymmetry is
  live today with the shipped tool, so waiting would leave a known defect in place to
  avoid a shape risk. #215 extends the projection rather than inventing it.
- **Replay composes badly with the truncation defect (#294).** Once results reach every
  later turn, an oversized payload collapsed into a mangled `preview` string is
  replayed too, and #215's web-search results will hit both at once. → Not fixed here,
  and #294 stays independent, but the composition is a reason to sequence #294 before
  #215 rather than treating it as unrelated cleanup.

## Archive-time hand edit (the tooling will not do this)

The shipped `tool-calling` Purpose states that tool activity "is display-only — never
re-fed into model context". D5 reverses exactly that clause. OpenSpec ignores a delta's
`## Purpose` for an existing capability, and its archive path seeds a Purpose only for
newly created capability specs — it does not rewrite an existing one. So nothing in
this change propagates the correction automatically.

If it is not hand-edited, the merged canonical spec will assert the old Purpose a few
lines above the new requirement that contradicts it, and the contradiction will read as
authoritative rather than as a leftover. Task 2.17 owns the edit and belongs to the
replay group, since that is the group that makes the sentence false.

## Migration Plan

A generated database migration adds
`compactions.tool_observation_ledger JSONB NOT NULL` with a valid empty v1 ledger as its
default. There is no config migration and no change to the shipped toolset. An existing
deployment sees these behavior changes:

- A run that terminates mid-tool — cancelled, expired, or failed — records the call as
  settled by termination instead of dropping it. All three terminal paths are in scope;
  none was previously settled.
- Existing raw tool activity begins replaying immediately and therefore contributes to
  compaction thresholds. The repaired fallback measurement is recorded in D5: the
  forty-call fixture moves from 2 to 5,702 estimated tokens and now crosses a
  1,000-token threshold.
- Existing compaction rows receive the empty ledger. This is deliberately **not** a
  retroactive recovery: tool observations already absorbed into prose summaries cannot
  be reconstructed reliably. Subsequent compactions preserve observations in the
  versioned ledger across normal and model-transition lineage.

Rollback is per-branch **except that replay cannot be kept without settling**. The
conventional representation requires every replayed call to be paired with a result,
and settling is what guarantees a terminated call has an outcome to pair with;
reverting group 1 while keeping group 2 would leave unmatched calls in replayed
history. Group 3 (JSON-Schema tools) is independent of both and can be reverted alone.

## Open Questions

None. Both previously open questions are closed: replay-safety vocabulary is moot
now that the dimension is not modelled here (D4), and how a withdrawal is represented
goes with withdrawal itself to #215.

## Revision history

Version bumps track substantive redrafts of this change's artifacts, not commits.

- **v21 (2026-08-08):** Stack review exposed JSON-Schema/runtime gaps hidden by
  utility-only tests: malformed schemas entered immutable snapshots and poisoned valid
  siblings, exact-string dialect lookup rejected supported draft-07 URI variants, Ajv
  silently ignored standard formats, and separate timeout signals misclassified
  cooperative cancellation. The full integration gate also proved that the SDK can
  swallow an asynchronous settlement-write rejection and let a worker acknowledge a
  nonterminal Run. Admission now compiles each tool independently before
  snapshotting, supported URI variants select the same constructor without source
  rewriting, `ajv-formats` is registered explicitly, and one composed signal plus
  terminal first-writer settlement distinguishes timeout from parent abort. Worker drain
  verification and central cancellation pickup settlement keep persistence failures
  retryable. Added the missing real-SDK/durable-history acceptance boundary and
  corrupted-snapshot failure.

- **v20 (2026-08-08):** PR repair made the replay limit enforceable instead of
  aspirational. Defined UTF-16 code-unit limits over the full serialized call/result
  envelope, explicit precedence (pairing, hard budget, newest observations, payload),
  atomic oldest-pair omission after non-expanding payload clearing, standalone chronology
  for interleaved text/tools and omission markers, structured outcomes with legacy
  fallback, the versioned compaction ledger and generated migration, the legacy-empty
  limitation, and the repaired compaction measurement. The earlier all-pairs-forever
  wording was impossible under a hard cap.

- **v19 (2026-08-07):** Review round 2, split decision. The hostile reviewer found a
  **third** shipped document asserting tool parts are excluded from replayed context —
  **SPEC.md §28.2**, the trust-boundary section — which the primary reviewer had just
  declared did not exist after an exhaustive grep of `openspec/specs/`. That corpus does
  not include the root SPEC.md. It is the worst of the three sites to leave: §28.2 is
  what a later capability author would cite to justify stripping tool parts. Task 2.19
  owns the edit, and the proposal's "No SPEC §13.5 change" line was rewritten because it
  invited the conclusion that no SPEC.md change was needed.
  Also: the audit still carried the "project as having produced no result" phrasing v18
  fixed in the spec; and "bounded per turn" had no stated precedence against "stable once
  projected" — a per-turn budget is evaluated over a growing set, so the spec now says
  over-budget turns clear oldest-first, permanently and one-directionally, with a
  scenario.

- **v18 (2026-08-07):** Second PR review round. Biggest finding: `model-system-prompts`
  carries a normative "MUST NOT replay ... display-only tool activity/results" that this
  change reverses — a second shipped capability contradicted, and unlike the `tool-calling`
  Purpose it is a requirement, so it needs a delta rather than a hand edit. Added that
  delta; my first hand-written version of it silently dropped five of the requirement's
  eight scenarios and invented an outcome for a sixth, so it was rebuilt mechanically
  from the original and the scenario list verified equal. Also: D3 still claimed tool
  schemas are draft-07 after D2 was rewritten to admit any declared dialect; "produced no
  result" wording contradicted the pairing requirement; the escape-proofing bullet did not
  pin the sloppy-spelling coverage the reused sanitizer already provides; "bounded" named
  no limit or overflow behavior and compaction clearing did not state that pairing
  survives; the portable representation has no field for the untrusted label or outcome
  status, now stated to live in the result content; the audit's "does not change" section
  still described a retired experiment; task 2.3 anchored on line numbers.

- **v17 (2026-08-07):** Review round, primary reviewer P0. The shipped `tool-calling`
  Purpose still says tool activity is "display-only — never re-fed into model context",
  the exact clause D5 reverses. OpenSpec ignores a delta's Purpose for an existing
  capability and does not rewrite one at archive, so the merged spec would have asserted
  both. No artifact mentioned Purpose at all across sixteen revisions. Added task 2.17
  and an archive-time section so the edit has an owner.

- **v16 (2026-08-07):** Review round, hostile reviewer P0. The Risks bullet on untrusted
  replayed output still described the mitigation as "Fenced" — the exact pre-reversal
  framing D5 retired — and dropped the load-bearing "not authoritative" wording. It was
  the only surviving site using fencing as a live mechanism rather than as narration of
  the rejected draft. **v12 below claims a staleness sweep after the reversals and missed
  it**, so a reviewer trusting that claim would have cleared the site. The audit's
  injection caveat had the same drift and is corrected too. Also caveated the Anthropic
  corroboration in D5: it cites a provider family llame cannot execute against
  (`providerType` is `["openai"]`), so it corroborates by analogy; the requirement rests
  on the provider-agnostic trained-shape argument instead.

- **v15 (2026-08-07):** Review round 1, self-found. Task 2.15 required verifying against
  "a second provider family", which is unimplementable — the instance-config JSON
  Schema pins `providerType` to `["openai"]` and names Anthropic a follow-up; reworded
  to the check that can run, with the second-family check deferred to that adapter. The
  audit's post-table summary miscounted its own table (claimed 7 match / 2 lead / 3
  open; actual 8 / 2 / 5 plus 1 n-a) and now states counts verified mechanically.

- **v14 (2026-08-07):** Dialect requirement dropped. Schemas are accepted as their
  source ships them and validated under the dialect they declare (draft-07 assumed when
  absent); refusal is reserved for a dialect no available validator supports. `ajv@8`
  ships 2020/2019 constructors, so refusing was never the cheaper option.
- **v13 (2026-08-07):** D3 reframed. The SDK does validate tool calls, but
  `safeValidateTypes` passes everything when `schema.validate` is undefined, which is
  what `jsonSchema(doc)` leaves it as. Supply the validator to the SDK rather than
  validating beside it.
- **v12 (2026-08-07):** Staleness sweep after the two reversals. F2's "not downstream of
  F1" claim was false under the new representation; the Migration Plan claimed one
  behavior change and independent rollback, both wrong; D7 was stranded after the
  deferred-items section.
- **v11 (2026-08-07):** Pairing reframed from provider validation to the trained shape,
  so it holds regardless of provider tolerance and constrains result _content_.
- **v10 (2026-08-07):** Replay form changed from fenced text to the conventional
  tool-call/tool-result representation. The earlier "text preserves portability"
  rationale was wrong: the SDK is the portability layer and already carries these parts.
- **v9 (2026-08-07):** Replay specified outright instead of gated on a continuity eval.
  Retired by the user-visible asymmetry (the UI renders results the model has lost) and
  the within-turn/across-turn inconsistency.
- **v8 (2026-08-07):** Issue-reference prefixes removed; wrapping now keeps references
  off line starts.
- **v7 (2026-08-07):** PR #295 review feedback applied — one factual error (snapshot
  format claim), three internal contradictions, two underspecifications.
- **v6 (2026-08-07):** Continuity measurement moved to the front of the stack.
- **v5 (2026-08-07):** Task groups aligned to the stack; close-out group dropped per the
  CHANGELOG rule.
- **v4 (2026-08-07):** Cancelled-call presentation specified.
- **v3 (2026-08-07):** Grilled decisions resolved — replay-safety cut, settlement
  idempotency added, continuity measurement split.
- **v2 (2026-08-07):** Cut to what #214 has a consumer for; five contracts deferred to
  #215 with rationale retained.
- **v1 (2026-08-07):** Initial change from the harness audit.
