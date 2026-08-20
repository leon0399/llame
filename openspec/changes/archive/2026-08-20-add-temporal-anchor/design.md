## Context

See `proposal.md` — Why. Requirements live in `specs/temporal-anchor/spec.md` and the `model-system-prompts` delta; this document covers only how they are met.

Three constraints from the existing system shape the approach:

- **The prompt is content-addressed.** `resolveEffectiveContext` hashes the already-rendered prompt to mint an immutable per-run snapshot. Any value that varies per turn mints a new snapshot every turn and defeats provider prefix caching for the whole conversation.
- **A frozen-until-compaction lifecycle already exists.** The recency digest is resolved once per chat, stored as a baseline, re-resolved only at compaction, and explicitly not re-resolved at a model switch. The anchor has the same shape and must not invent a second, subtly different one.
- **The template context is a strict allowlist.** `PROMPT_CONTEXT_PATHS` is validated at boot against the parsed Handlebars AST, with gate-only paths separated from value paths by position. Anything new must fit that discipline rather than bypass it.
- **Compaction does not re-render the prompt.** It replays `state.sourceSnapshot.systemPrompt` from the source snapshot, so the summarizing model sees the anchor as it stood, and the refreshed anchor first appears on the next ordinary run — which re-derives it from the now-newer compaction. No render call site exists in the compaction path, though the compaction _instruction_ does change — see the checkpoint-exclusion decision below.

```text
chat created ──► turn ──► turn ──► model switch ──► turn ──► COMPACTION ──► turn
     │                                   │                        │
     └── anchor resolved ────────────────┴── unchanged ───────────┴── re-resolved
         (derived: latest compaction ?? chat creation)
```

## Goals / Non-Goals

**Goals:**

- One anchor value per chat, derived rather than stored, correct on the first turn of a brand-new chat.
- Rendering that a weak model can use without carrying a timezone database.
- Structural guarantee that the anchor is always present, rather than a convention maintained by comments.
- A vocabulary that #454 and #455 can extend without renaming or re-shaping what ships here.

**Non-Goals:**

- Any second reading of the instant (stored user timezone, browser-derived timezone, GeoIP) — #454 and #455.
- Any per-turn timestamp — #408, which is blocked on this change and inherits its format and timezone convention.
- Changing the recency digest's `compiledOn`, its lifecycle, or its rendering.

## Decisions

**Derive the anchor; do not store it.** `latest compaction createdAt ?? chat.createdAt`. Both values already exist, and `buildTurnContextAndParts` already reads the latest compaction for the disclosure-epoch and digest-rebake logic, so the value is in hand at the point of render.

_Alternative — a `chats.temporal_anchor` column set at creation and updated at compaction._ Rejected: it introduces a migration to record something already implied by existing rows, and creates a second source of truth that can silently drift from the compaction row that is supposed to drive it. The existing digest rebake already keys off the compaction row's identity, so deriving is the consistent choice.

_Consequence to respect:_ the compaction read currently happens only when a previous run exists. That is sound — a chat with no previous run has no compaction either, so the fallback to creation time is correct — but the derivation must not be moved somewhere that skips the read.

**Render in the instance's local timezone, not UTC.** llame is self-hosted and the operator is frequently colocated with the instance, so local time is immediately readable without mental conversion; UTC would be less useful for the common case and no more correct for the uncommon one. Both readings are wrong for a remote user, which is what #454 exists to fix — the choice here is which single reading is most useful before that lands.

**Read the instance timezone from the process environment, not from config.** Node honours `TZ`, and every container runtime and init system already sets it, so `TZ` is the native mechanism for this and a `llame.config.json` key would duplicate it while raising a precedence question (config vs. environment) with no good answer. The consequence is documented rather than mitigated: a container with no `TZ` set reports UTC, so an operator who wants local time must set it.

_Note:_ the resolved identifier is ICU's canonical spelling for the zone, which can differ from what the operator set (`Asia/Kathmandu` resolves to `Asia/Katmandu`). Both are valid; tests should not assume the input spelling round-trips.

**Carry a numeric UTC offset alongside the IANA identifier.** An IANA name alone requires the model to know the zone's daylight-saving rules for that specific date. The offset removes that dependency entirely, and the decision is asymmetric — an explicit offset cannot make a model _worse_ at time reasoning — so it does not warrant an evaluation to settle for the handful of tokens it costs.

**Derive the offset and the zone identifier from a single formatting operation.** They are two views of one fact, so producing them independently would admit a state where they disagree; a disagreement between them is worse than either alone. One formatter, one instant, both values read off the same result.

**Minute precision, no seconds.** Seconds add noise to a value describing a conversation boundary. Minute precision is honest here only because the framing is historical — see below.

**Two scalar paths (`context.systemTime`, `context.systemTimezone`), not a collection.** The offset rides inside `context.systemTime` so the contract stays two paths.

_Alternative — a `context.times` collection iterated with `{{#each}}`, so #454 and #455 rows appear automatically in prompts operators never edit._ Rejected: labels would become server-authored prose inside the operator's own block, contradicting the requirement that operators control placement and phrasing, and it diverges from the established shape where `user.*` and `chats.*` scalars are paired with operator-written framing. Operators who maintain custom prompt files are precisely the people who do not want rows appearing unannounced. The cost is accepted and explicit: when #454 lands, custom-prompt operators must edit their file to gain the row, exactly as they must today to gain any per-user path.

**Make `context` unconditional, and the parameter required.** `user` and `chats` are gate-only because they are legitimately absent; the anchor never is. Passing it as a required parameter is what makes "always provided" enforced by the compiler rather than asserted in a comment — the same discipline by which `resolveEffectiveContext` takes an already-rendered prompt so that "render, then hash" cannot be reordered.

_Consequence:_ `context` stays out of the gate allowlist, so a bare `{{#if context}}` fails boot. That is deliberate and preferable to compiling an always-true branch that misleads the author into thinking the value can be absent.

**Format through a pure `(instant, timeZone)` function, resolving the system zone at the composition boundary.** The formatter takes the zone rather than reading it, and `Intl.DateTimeFormat().resolvedOptions().timeZone` is read per render where the anchor is assembled — not cached at module load, which would need a reset hook in tests and would miss a `TZ` change without a restart.

This is decided by #454 rather than by testing convenience. That follow-up renders the same instant in a second zone; a formatter that resolves the zone internally could only do so by mutating `process.env.TZ` around the call, inside a request path, in a concurrent server. Node does honour runtime `TZ` mutation, which is precisely what makes that anti-pattern tempting enough to rule out explicitly. Parameterizing is therefore avoiding a known-broken design, not adding configurability nobody asked for — the second caller is already specified.

The secondary benefit is that the fractional-hour and daylight-saving tests become pure assertions instead of global environment mutation inside a suite whose files run in parallel workers.

**Take rendering inputs as an options object.** The anchor is required while `user` and `chats` are optional, and TypeScript forbids a required parameter after optional ones — so a positional anchor is forced into position 1, shifting the others. Two sites index the signature positionally today (`Parameters<SystemPromptsService['render']>[1]` in `chat-loop.service.ts`, `Parameters<typeof renderSystemPromptTemplate>[2]` in `prompt-loader.test.ts`), and both #454 and #455 add further optional inputs to this same signature. An options object makes required-ness independent of position and turns each follow-up into an added field rather than another reshuffle.

_Counterargument considered:_ `SystemPromptsService`'s doc comment deliberately keeps the interface narrow, warning that growth signals someone building prompt composition. An options object is a marginally more inviting surface to grow — but it introduces none of the three things that comment names (an `await`, a chat id, a second template), and the real guard against composition is the boot validator and the capability spec, not signature awkwardness.

**Frame the rendered value historically and basis-neutrally, never as the present instant.** A present-tense form ("Current system time: ...") rots within the hour and is the confident-lie failure this change exists to avoid; it belongs on #408's per-turn rail, where it is genuinely current. But a start-framed form ("This conversation began on ...") is equally wrong: the anchor becomes the compaction time once a chat is compacted, and would then assert a start date the conversation never had. The packaged wording is therefore **basis-neutral** — context _as of_ the anchor, explicitly not the current time — which is true whether the value came from creation or from compaction. Historical framing is also what buys the minute precision: sub-day precision on a statement about an established reference point is durable, while the same precision on a present-tense claim is actively misleading.

_Alternative rejected:_ a third path naming the basis (`started` vs `compacted`) so the operator could phrase each case exactly. It breaks the two-path contract and leaks a lifecycle detail into operator vocabulary for a distinction the model cannot act on.

**Keep the anchor out of compaction checkpoints.** `compaction.ts` already defines a standing-context exclusion telling the summarizing model not to carry the personalization and chat-history blocks into the checkpoint, on the grounds that they are standing context re-supplied every request and must not be frozen. The anchor matches that rationale exactly: a checkpoint embedding a stale "context as of" line would sit alongside the refreshed anchor in the live prompt, giving the model two conflicting timestamps with the stale one presented as established fact.

It is added as a **clause in the existing instruction rather than a new delimited block**. The existing exclusions are named by delimiter, but those delimiters exist mainly to frame untrusted owner content; the anchor is server-computed and one line long, so wrapping it purely to make it excludable would be disproportionate.

_Risk to word around:_ an over-broad clause would strip in-conversation temporal facts — a deadline the user stated, an interval the assistant established — which are exactly what a checkpoint exists to carry forward. The wording must target the system-supplied line, mirroring how the existing exclusion closes by explicitly protecting user-stated constraints. Like that exclusion, this rests on model compliance rather than structural enforcement.

**Retain `chats.compiledOn` unchanged.** It records when the digest was compiled — a different instant from when the conversation began. The anchor makes it interpretable rather than superseding it; folding them together would lose a distinction the digest capability depends on.

## Risks / Trade-offs

- **Offset and zone identifier could disagree if produced separately** → derive both from one formatting operation over one instant; assert the pairing in tests, including a fractional-hour zone where an hours-only assumption would be caught.
- **Signature churn touches every existing render call site** → mechanical and compiler-enforced, so the failure mode is a build error rather than a silent wrong value. It is most of the diff's line count; plan the task breakdown around that rather than discovering it mid-implementation.
- **A containerized instance defaults to UTC**, so "local time" is UTC and no more useful than the rejected alternative → still correct and honestly labelled, and it is exactly the case #454 addresses. Not mitigated here.
- **A long-running chat's anchor drifts far from the present** → mitigated by framing, not by freshness; #408 supplies the fresh value on the rail. The frozen anchor is deliberately the affordable half.
- **Operators with custom prompt files gain nothing until they edit them** → accepted and documented; identical to the existing behavior for per-user and digest paths, and the packaged default carries the line for everyone else.
- **A boot probe that forgets the anchor would validate templates against a shape no run produces** → the required parameter makes omission a compile error rather than a probe that silently under-tests.

## Migration Plan

No database migration, no schema change, and no server-authored message-part schema — so this is not a coordinated API/worker revision boundary and needs no writer quiescing or run draining. Deployment is an ordinary code release: workers and API can roll independently, since the anchor is computed per render from rows both already read.

Rollback is a straight revert. Snapshots minted while the change was live remain valid and readable — they are immutable rendered text, and nothing reads the anchor back out of them.

The packaged default prompt gains one line; operator prompt files are untouched and keep rendering exactly as before.
