## Context

See [proposal.md](proposal.md) — Why. The constraints that shape the approach, all verified in the current tree:

- **The system prompt is re-rendered and content-hashed per run.** `chat-loop.service.ts` resolves the owner's per-user context, renders, then calls `resolveEffectiveContext`, which hashes the rendered string. Snapshots are content-addressed and reused per owner. Anything volatile in the prompt mints a row per turn.
- **Compaction replays the bound snapshot's system prompt verbatim** as the summarizer's `system` (`compaction.service.ts:314`), and the summarization instruction asks for a `Constraints and Preferences` section. `model-system-prompts` already closes this channel for personalization by **naming the block's delimiter** in the instruction — a mechanism this change extends rather than invents.
- **The prompt template validator is deny-by-default over the parsed AST** (`prompt-loader.ts`): `ALLOWED_BLOCK_HELPERS = {if, unless}`, a flat scalar path allowlist, `depth > 0` rejected, gate-only paths legal solely as a conditional's subject.
- **`ChatsRepository.findByOwner` already answers both queries.** Its `pinned: 'only' | 'exclude'` modes are disjoint and both order `desc(chats.updatedAt)`; the web pinned and All categories are exactly these two calls. It takes no limit yet.
- **A trusted server-authored part rail is shipped twice** — `data-model-context` (model switch) and tool-availability parts — with strict shape validation on write and a server-owned renderer at build time (`chats/model-context-part.ts`, `context-builder.ts:312`).

## Goals / Non-Goals

**Goals:**

- Keep the effective prompt byte-identical across a chat's turns, so snapshot reuse and provider prefix caching behave exactly as they do today after the first turn.
- Keep every listed entry immutable once resolved, so no rendering ever has to reconcile two versions of the same entry.
- Make the digest expressible in the operator's existing prompt-file vocabulary rather than a second, parallel authoring mechanism.
- Bound the injection and disclosure surface by construction (caps, excerpt truncation, delimiter integrity) rather than by prose alone.

**Non-Goals:**

- Structural (non-advisory) enforcement of the data-not-instructions framing. This change accepts the same advisory posture `personalization` already documents; a fence an operator cannot edit is a different, larger design.
- A live view. The digest is a snapshot plus an event log, never a continuously reconciled projection of current state.
- Any operator-facing customization surface beyond the ordinary prompt file.

## Decisions

### D1 — System-prompt rail with a per-chat frozen baseline

**Chosen** over a typed part rendered immediately before the user turn.

The three standing objections to the system-prompt rail are content- and volatility-dependent, and freezing removes two outright. Snapshot churn becomes one row per chat rather than one per turn. Prefix-cache loss narrows to the first turn of each new chat (~2–4k tokens that would otherwise have been reused from the previous chat), because within a chat the prompt is byte-identical — and implicit provider caches expire in minutes anyway, so for sporadic chat creation the real loss approaches zero.

What survives is trust escalation, and it is accepted deliberately with mitigations (D7, R1). The rail also buys receipt disclosure for free: the snapshot already carries the rendered prompt verbatim, so the transparency requirement needs no new mechanism.

_Alternative rejected:_ typed part before the user turn. Structurally safer on escalation and compaction, but requires a receipt extension, re-renders per turn, and cannot be expressed in the operator's template vocabulary — which is the unification property this design is buying.

### D2 — Freeze the inputs, not the output

The resolved entries are stored as JSONB on the `chats` row and re-rendered every run. Rendering a fixed input through a fixed template is deterministic, so the output string is byte-identical and the existing content-hash reuse path works untouched.

_Alternative rejected:_ pin the chat to its first run's snapshot id. That invents a per-chat binding concept and interacts badly with model switches, availability deltas, and retry determinism. Freezing inputs needs no new concept.

Per-chat state is therefore **two fields, not one**, with deliberately different lifecycles: the **rendered baseline** (frozen until re-resolution — this is what makes the prompt byte-identical) and the **told-set** (grows with every append). Conflating them into a single "baseline" blob would make the freeze guarantee false for half its contents. The told-set keys on chat id; storing an identifier for bookkeeping does not contradict omitting identifiers from rendered output (D13), because nothing stored there is ever rendered.

_Alternative rejected:_ store only chat ids and re-read titles at render time. Titles are mutable, so entries would silently change and the prompt would stop being byte-identical. The baseline must be a denormalized copy — which is also why chat deletion cannot reach it (R4).

### D2a — Resolve on the chat's first run, which on the main path _is_ creation

There is no `POST /chats`. The controller exposes only `:id/messages`, `PATCH :id`, and `:id/forks`; the client mints a chat id and `ChatsRepository.createIfAbsent` materialises the row inside the first send. Context resolution already lives in that same flow (`chats.controller.ts:274` → `ChatLoopService.createMessageStream`), so "chat creation" and "first run" are the same moment on the main path — no new hook, no state resolved outside a binding transaction, no draft going stale before it is used.

The spec anchors on **first run** rather than creation anyway, because that phrasing also covers the secondary creation paths (`create()` / `createChat`, used by forks) under one rule instead of two.

### D3 — Re-resolve at compaction only

Compaction is a **context** boundary: history before `uptoSeq` is already replaced, the tail is already cold, and most prior deltas evaporate with it. Refreshing there is nearly free and lands on a clean rail.

A model switch is a **provider** boundary. The conversation is unchanged; only who reads it changed. Its cache is cold too, so refreshing would also be "free" in tokens — but it would strand every delta ever appended (nothing is dropped from history on a switch), and it would change what the assistant knows about the owner as a side effect of an unrelated action.

Note what this does **not** bound. Compaction fires on `contextWindowTokens x COMPACTION_WINDOW_RATIO` (0.8, `compaction.ts:31`) — roughly 160k tokens on a 200k model — so a chat that stays modest in length never re-bakes at all. Append accumulation, meanwhile, tracks how often the owner starts other chats. The reset trigger and the growth driver are on **uncorrelated axes**, so the epoch reset is real only for chats that actually compact (R11).

_Alternative rejected:_ never re-resolve. Staleness compounds exactly where it is worst — chats long enough to compact are long-lived — and deltas then need a hard cap that would silently exceed or contradict the 10/10 caps.

### D4 — Deltas are an event log derived by set difference, not by timestamps

Appends describe events, not state. Restating the full list on each change was rejected on cost: ~20 entries × (title + 200-char excerpt) ≈ 1400 tokens written into **permanent history**, versus ~70 tokens for an event. Five fires in one chat is the difference between ~350 and ~7000 permanent tokens.

**Events are derived by diffing the told-set against the currently eligible chats — never from timestamps.** This is forced, not preferred. Verified: `chats` carries no column recording when a title landed (`created_at`, `updated_at`, `archived_at` only, and `updated_at` bumps on every message), and unpinning is a hard `.delete(pins)` (`pins-repository.ts:150`) that leaves no trace. A timestamp-based derivation is blind to two of the three transitions it would need, and closing that would mean adding a `title_set_at` column and soft-deleting pins — schema changes serving nothing but this feature.

The diff is **asymmetric**: entering the eligible view or changing pin state appends; leaving it does nothing. That single asymmetry absorbs three separate rules — displacement, archival, and deletion are all just departures, so none of them needs its own clause.

It also collapses the event vocabulary to **one** event. "Gained a title" is the common _reason_ a chat becomes eligible, not the transition. A chat below the cap that the owner returns to re-enters the view having gained no title at all, and deserves an append on exactly the same footing — a case a title-triggered design would silently never announce.

Two things the diff must compare against, and they are not the same:

- **Pin state means membership in `pins`, never membership in the rendered pinned list.** A newly pinned chat can push another past the cap; the displaced chat is still pinned, and diffing rendered-list membership would fabricate an unpin event for it on every such displacement.
- **The told-set holds only announced chats.** Resolving the lists needs the owner's full pin set (a capped ordered selection cannot be computed from a partial one), but that is selection input. Recording pin state for never-announced chats would let unpinning one emit an append that introduces the chat purely to demote it.

_Alternative rejected:_ diffing against the rendered baseline instead of the told-set. The baseline is frozen and capped, so any chat announced by an append is permanently absent from it and would re-fire on every subsequent run.

### D15a — Forks list their parent, and that is correct

`:id/forks` copies history, so a fork and its parent share a first user message — the fork's digest quotes the fork's own opening line as belonging to another chat. Odd-looking, and correct: the parent genuinely is a separate, closely related conversation, and knowing it exists is exactly the awareness the digest is for.

Mechanically it arrives in the fork's **baseline**, not a delta: forking is not a run, so the fork's baseline resolves on its first send, by which time the parent is eligible. The delta path applies only when the parent was still untitled at that moment and gains a title later. Both routes are correct; no rule is needed for either.

### D16 — Ratios, not prose, for what is omitted

The block states `10 of 30 pinned` and `10 of 247 chats` rather than asserting that some entries were omitted. The denominators are the exact eligible populations each list draws from, so the ratios describe the lists rather than approximating them.

The reason is behavioral: `10 of 12` and `10 of 247` warrant opposite retrieval decisions and produce identical prose under a qualitative statement. The ratio is the cheapest possible signal for the judgment the digest exists to inform — roughly ten tokens for both.

It also absorbs the pinned-overflow problem without changing the selection rule. Pinned chats past the cap are invisible in both lists, but the model is told 30 exist, so a reference to one it cannot see reads as a retrieval cue rather than a contradiction.

Deliberately excluded: lifetime activity measures, message frequency, session depth, streaks, model-usage breakdowns. Research §2 observation 2 records those as the part of the studied product's metadata block that cannot change an answer and invites the model to reason about the user as a usage cohort. Counts of the owner's own corpus are a retrieval input; measures of the owner's behavior are not.

_Alternative rejected:_ a rolling "chats in the last 30 days" count. It introduces an arbitrary window that matches neither list — the recent list is the top 10 by recency regardless of age, so an owner whose only chats are six months old would see three entries above a count of zero.

### D5 — Top-level `chats`, not `user.chats`

Verified against `apps/api/src/prompts/chat-default.md:20`, which gates the whole personalization block on `{{#if user}}`. Nesting the digest under `user` would make that gate true for an owner who has chats but authored no personalization and shares no identity — rendering the personalization block's framing prose around nothing, contradicting the shipped `personalization` scenario _"Owner has no per-user context"_.

Top-level `chats` also matches the separate-axis decision: this is not personalization, and the `personalization` spec normatively forbids fields derived from conversation content.

### D6 — Bounded iteration, not general `each`

`each` is admitted with four constraints, all enforced in the existing AST walk:

1. Single parameter, and it must be a **declared collection path** — not a scalar, not a gate path, not unknown.
2. Inside the body, only that collection's **declared item fields** resolve. Collections declare their fields (`title`, `date`, `messageCount`, `excerpt`); the projection never exposes whatever an item object happens to carry.
3. No nesting, no block params, no `@index`/`@key`.
4. The collection stays gate-only in value position, so `{{chats.recent}}` fails boot exactly as `{{user}}` does today.

Item paths are validated as a distinct scope keyed to the enclosing `each`'s collection, rather than by widening the flat allowlist — otherwise `{{title}}` would become legal at top level.

_Alternative rejected:_ a server-composed pre-rendered string injected through one scalar path. Cheaper, but it is the composite-context value the `personalization` spec explicitly forbids, and it hands the operator no control — losing the reason for choosing this rail.

### D7 — 200-character excerpt, specified as a security control

The excerpt is the first user message truncated to 200 **Unicode code points**, cut on a code-point boundary with no word-boundary heuristic (llame's corpus is routinely non-Latin; a word heuristic would behave inconsistently across scripts).

The cap's stated purpose is injection and disclosure control, not tokens: a first user message is the message most likely to contain a bulk paste, and 200 characters typically retains the owner's own framing prose while truncating the payload. Recording the _reason_ in the spec is what stops a later "quality" tuning pass from raising it.

The excerpt is read from the earliest stored user message by `seq`, independent of that chat's compaction state — so an entry is immutable for the chat's lifetime, which is what makes a frozen baseline and a later delta agree about the same chat.

### D8 — Disjoint lists via the shipped query modes

Pinned uses `findByOwner({ pinned: 'only' })`, recent uses `findByOwner({ pinned: 'exclude' })`. They are already disjoint and already ordered `updated_at DESC`, so dedupe and backfill fall out for free and the digest cannot disagree with the chat list the owner sees. `findByOwner` gains a limit; no new SQL is introduced. Ordering follows #328 once explicit pin ordering ships.

### D9 — A separate `memory` settings surface, default off

Not a `personalization` field: that capability normatively forbids conversation-derived content, and `personalization.enabled` means "use my authored profile". `shareRecentChats` is worded as _"share my recent chats"_ rather than _"the assistant may use my history"_ so #326's master gate composes above it as a conjunction without redefinition.

Default false follows the spec's stated asymmetry — a toggle that moves data the owner never authored for the purpose defaults off. The cost (inert until opt-in) is accepted, and is the reason #327 is worth shipping as the discoverable pull-side counterpart.

### D10 — Extend the existing compaction exclusion

`model-system-prompts` already requires the summarization instruction to name the personalization delimiter and forbid carrying its content out. The digest adds its delimiter to that same instruction. No new mechanism, and explicitly **not** by editing the replayed prompt, which would diverge position 0 and cold-start the whole summarization call.

### D11 — Deltas gated by the setting alone

The system does not parse the active template to decide whether the digest block rendered. An operator template that omits the block still receives appends. Accepted and documented, consistent with the shipped rule that a prompt referencing no per-user path silently forgoes that content — appends are self-describing enough to be merely uncontextualized rather than nonsensical.

### D12 — Reserved delimiter

`<user_chat_history>`, added to the reserved-tag set alongside `<user_personalization>`, so no title or excerpt can emit it as a tag at all. Dates render as absolute ISO calendar dates, per llame's absolute-dates authoring convention.

### D13 — Four fields per entry, chosen by what a token buys

Every field is multiplied by twenty entries and frozen for the chat's life, so the field set is a budget decision, not a completeness one. `title`, `date`, `messageCount`, `excerpt` — and deliberately **not** `id` or `project`.

**`id` cut.** No shipped tool accepts a chat id: `search_conversations` takes `query` and `limit`, and there is no `get_chat`. A UUID tokenizes as hex fragments at ~18–20 tokens, so twenty entries would freeze ~400 tokens of identifier the model cannot act on into every prompt — roughly 20% of the block for zero capability. Identifiers belong on transient requested surfaces (#327 returns them; #331 consumes them), not in standing context. Re-adding one later is a template edit, and #332 may make it far cheaper.

**`project` deferred.** `chats.project_id` and `projects.name` exist and would be excellent signal — a project is the owner's _own_ topical grouping, better than anything inferred. But projects have no surface inside a chat today: the model cannot see the current chat's project, cannot reason about membership, and cannot act on it. Annotating digest entries with a fact the model can do nothing with is decoration. #333 is the epic that makes it worth carrying.

**`messageCount` kept** at ~3 tokens: it separates a throwaway question from a substantial working session, which is exactly the judgment the model has to make about whether a chat is worth retrieving. Frozen-stale, harmlessly.

### D14 — Dates need an anchor, and llame has none

Verified: no current date or time reaches the model anywhere — `chat-default.md` has none, and `PROMPT_CONTEXT_PATHS` exposes no temporal path. An absolute date in the digest is therefore not directly interpretable: the model cannot place `2026-07-20` relative to now except by guessing from its training cutoff.

Relative dates are not the fix and are strictly worse — a frozen baseline renders the same string indefinitely, so "three days ago" becomes a confident lie. That is the exact rot the research note records in ChatGPT's inferred-memory block (§2, observation 3).

Two things carry the weight instead. Ordering already conveys relative recency for free, since the lists are most-recent-first. And the block states **its own compilation date**, so each entry is computable against a known point and the list's frozen nature is legible rather than hidden — roughly ten tokens, once.

This is an interim measure. #334 proposes a proper temporal anchor on the same freeze-and-refresh-at-compaction lifecycle; when it lands, the digest should consume it rather than keep a private copy.

Related: the date is **last activity** while the excerpt is the **first** message, so a long-running chat shows a recent date beside an old opening line. The date is labelled rather than given a second field, because a second date costs twenty more entries' worth of tokens to resolve an ambiguity a label resolves for free.

### D15 — The event diff needs a short-circuit on the send path

Every send by an opted-in owner would otherwise run a told-set diff, and the overwhelmingly common answer is "nothing changed". A per-owner change counter — bumped by title generation and by pin mutations, compared against the value stored beside the told-set — makes the common case one integer comparison, with the real diff running only on mismatch.

Concurrency is largely handled already: migration `0012`'s partial unique index enforces single-flight runs per chat, so two sends cannot race within one conversation. The told-set advance must still commit in the same transaction as the append (specified), or a failed run marks the conversation as told about an event it never received.

## Risks / Trade-offs

**R1 — Conversation-derived text acquires system-role authority.** An owner pastes attacker-controlled content into chat A; its first 200 characters become system-prompt content in chats B..Z. → Mitigated by the 200-char cap (retains the owner's framing, truncates payloads), the tag sanitizer (structure cannot be forged), opening framing plus a trailing restatement of instruction-following, and the structural guarantee that `resolveAdvertisedTools` receives no digest input so the tool set cannot widen. Residual risk is accepted: framing is advisory, matching the posture `personalization` already documents.

**R2 — Exfiltration blast radius grows.** A successful injection can read the digest out of context — the published ChatGPT attack against exactly this surface. → Reachability is not new (`search_conversations` already exposes bodies to an injected model); what changes is that it becomes silent rather than requiring a visible tool call. Separately, llame currently renders assistant markdown with no `allowedImagePrefixes`/`urlTransform` override and ships no CSP (`apps/web/next.config.mjs` sets none), so the egress channel that attack used plausibly exists. **That gap should be closed independently of this change and is not a mitigation this change provides.**

**R3 — Digest content laundered into a persisted checkpoint.** The summarizer sees the digest and may echo entries under `Constraints and Preferences`, where they persist as replayed history that neither chat deletion nor the toggle can reach. → Mitigated by D10. Model-compliance, not structural; the structural fix (excluding it from the summarization input) is foreclosed by the rail choice and is named as such rather than glossed.

**R4 — Deletion is not erasure across chats.** A deleted chat's title and excerpt survive in other chats' bound baselines, appends, and receipts. → Not mitigable under a denormalized frozen baseline (D2); disclosed as a normative spec statement and in the API contract.

**R5 — Withdrawal is not retroactive.** Owners will read the toggle as "stop sharing my other chats". → Disclosed in the same terms `shareAccountIdentity` uses.

**R6 — Operator removes the framing.** A replacement template can reference the digest paths with no framing prose at all. → Documented, not defended. Same exposure personalization already carries.

**R7 — First-turn cache cost per chat.** Each new chat cold-starts its system prompt. → Quantified (~2–4k tokens, once per chat) and accepted; strictly better than a per-turn digest and than Letta's per-step recompilation.

**R8 — Forward multi-sender leak.** The prompt renders for the _sender_ (`chat-loop.service.ts:131` passes `input.userId`), not the chat owner. Correct today, since chats are owner-only. When multi-sender writes land, a participant's digest would render into another owner's chat. → Stated as a forward constraint now; cheap to record, expensive to discover later.

## Migration Plan

**This change adds a server-authored message-part schema**, so it is a coordinated API/worker revision boundary per `apps/api/AGENTS.md`, not a single deploy.

1. **Schema, backward-compatible.** Add the `chats` baseline JSONB column (nullable — a null baseline means "no digest", which is every existing chat) and the memory-settings storage with `FORCE ROW LEVEL SECURITY` hand-appended, since Drizzle emits `ENABLE` only. No backfill: existing chats legitimately carry no baseline.
2. **Deploy readers first.** Ship workers able to render the digest delta part while no API authors it. Unknown parts are already ignored by `buildContext`'s part scan, so this step is safe in either order — but doing it first is what makes step 3 safe.
3. **Deploy the authoring API.** Only after compatible workers are live may the API author digest parts.
4. **Feature is inert until opt-in.** `shareRecentChats` defaults false, so no owner's behavior changes on deploy and the blast radius of a bad rollout is limited to owners who opted in.

**Rollback:** stop authoring first (disable the setting path), drain Runs accepted by the newer API, then roll binaries back. Retained baseline columns and persisted delta parts stay in place and render as inert history. Do not roll workers back before the drain.

**R11 — Appends are unbounded in chats that never compact.** The epoch reset depends on compaction, which fires on chat _length_; appends accumulate with the owner's chat-_creation_ rate. A conversation open for a month at 20k tokens never re-bakes while the owner starts sixty chats: ~60 appends x ~100 tokens ≈ 6k tokens of permanent history on top of the baseline, and a told-set that never resets. → **Accepted uncapped for now.** A hard cap would silently withhold chats the owner is actively working in, and a size-triggered re-bake is worse than the disease: outside compaction, changing position 0 cold-starts the entire accumulated history, which is precisely what freezing buys. An adaptive append policy — throttling as the epoch grows rather than cutting off — is the right shape later and is deliberately not attempted here.

**R12 — A renamed chat's title stops matching retrieval.** The baseline freezes titles; `searchByOwner` runs a live title leg over `chats`. After a rename the model holds a string that matches nothing, which weakens the digest-to-search composability used to justify omitting chat ids (D13). → Partially self-mitigating: the excerpt is verbatim message content and is present in the search projection, so a content-derived query still reaches the chat. The packaged default states that titles are point-in-time and may have been renamed, so the model treats a miss as staleness rather than as the chat not existing. Not worth a rename event: it would reintroduce a second transition into a vocabulary D4 deliberately collapsed to one, for something that happens rarely.

**R10 — The snapshot table's growth model changes qualitatively.** Today the reuse key is `(owner, content_hash, source)` plus availability, so one owner on one model with unchanged personalization shares a **single** snapshot across every chat they have. A per-chat digest makes every chat's prompt distinct by construction, so each mints its own row storing the full prompt text, plus another per compaction. A thousand chats is ~1000 rows × 4–8KB ≈ 4–8MB per heavy user, against a handful of rows today — a 100–1000× increase in an append-only table with no purge path. The digest is also stored twice per chat: once as the baseline, once rendered into each snapshot's prompt text. → Accepted; it is small beside `messages`, and it is the direct cost of the freeze that buys everything else. Recorded here because the proposal's "one row per chat" reads as a win against a per-turn digest and should not be mistaken for a win against today.

**R9 — Token cost is script-dependent and larger than it looks.** Per entry in English: title ~10 + date ~6 + count ~3 + excerpt ~50 + markup ~12 ≈ **80 tokens**, so twenty entries ≈ **1.6k**. Cyrillic tokenizes at roughly 2–3× English per character, so a Russian-heavy corpus pushes the same block to **2.5–3k**. On a large window that is noise; on a 32k local model it is ~9% consumed before the conversation starts, and compaction triggers at `contextWindowTokens × 0.8`, so it eats the budget early. → Accepted. The 200-character cap stays a **character** cap: its job is truncating pasted payloads, which is a character-count property, and a token cap would couple truncation to a tokenizer and make the same chat render differently per model. Documented so operators running small local models know what they are spending.

## Open Questions

- Whether the packaged default should name `recent_chats` in its truncation sentence once #327 ships. Deliberately not named now, because naming an unadvertised tool invites a repair-path call; revisiting is a prompt-file edit that changes no requirement.
- Whether the digest should state the _number_ of omitted chats rather than only that omission occurred. Cosmetic, decidable later, changes no requirement or task.
- Whether the digest keeps its own compilation-date line or consumes #334's temporal anchor once that ships. Deferrable: both render the same absolute date on the same lifecycle, so the merge is a prompt-file edit.
