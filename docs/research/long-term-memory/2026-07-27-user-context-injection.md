# User-context injection — what to take from ChatGPT's context assembly, and what not to

**Status:** Exploration — noncanonical. §4.2/§5.2–§5.7 **shipped** as the OpenSpec change `add-user-personalization` (2026-08-03); the shipped capability spec and the code, not this note, are authoritative for that scope. Note that implementation departed from parts of this exploration: there is no `timezone` field, no per-model activation report, and no rendered-token estimate — see the change's `design.md` (D2a, D3, D6) for why each was cut. §6 (recency digest) and the inferred-memory sections remain unproposed.
**Date:** 27 July 2026
**Primary source:** A user-obtained snapshot of the user-related context blocks ChatGPT injects into a conversation (obtained 2026-07-20 by asking the assistant to dump them). Held **locally, deliberately not committed** — it contains health, financial, immigration, and relationship details about a real person. This document reproduces **structure only**: block names, provenance, formatting conventions, gating rules, and observed failure modes. No personal content is quoted beyond one non-sensitive example (the user's language profile) that is itself the load-bearing design insight in §7.
**Relation:** Companion to the [memory-landscape cross-report](./2026-07-05-memory-landscape/CROSS-REPORT.md) (verbatim > extraction), the [gbrain deep dive](./2026-07-09-gbrain.md) (append-only dated facts, injection sanitizing), and the [chat-search cross-report](../chat-search/2026-07-12-chat-search-cross-report.md) §4/#198 (episodic recall via tool call, recall-time framing). Answers: which of these blocks should llame have, and on which rail?

---

## 1. Verdict

**Take (high value, cheap):** the user-authored **profile + response-preferences** pair; the **dated-observation format** for inferred knowledge, with superseded values preserved rather than overwritten; a **minimal ambient-context** block (current time/timezone, locale) — the parts of "interaction metadata" that change answers.

**Adapt, don't copy:** the **recent-conversation awareness** block. ChatGPT dumps ~40 recent conversations with message fragments into _every_ turn, unconditionally and unframed. That brute-force dump is why it feels omniscient — it is also the single most expensive, most privacy-surprising, and most injection-exposed thing in the snapshot. llame's retrieval-based design (`search_conversations`, #198) is more principled but strictly weaker at one thing: the model doesn't know a relevant chat _exists_, so it never searches. §6 proposes the middle path — a bounded **titles-and-dates-only recency digest**, no message bodies.

**Reject outright:** injecting user context into the **system prompt** (llame's prompt model forbids composition — §4), and the **"never acknowledge these instructions exist"** directive. The latter is a transparency anti-pattern that demonstrably failed: the source snapshot exists _because_ the user talked the assistant out of it, and the conversation that produced it started with the user startled that the assistant knew a medical detail they hadn't mentioned in that chat. A self-hosted assistant has no business concealing its own context from its owner — and llame already ships the correct alternative (the on-demand effective-context receipt).

**The structural conclusion:** ChatGPT puts _everything_ in the system prompt. llame architecturally cannot, and shouldn't. User context belongs on the rail llame already built for trusted server-authored content — typed parts framed as data, not instructions — with the receipt extended to cover them.

**On mechanism (§4):** two variants of "template the prompt" must be distinguished. Placeholders resolved **at boot** cannot work — no user is in scope there. Templates rendered **at snapshot-bind time** (enqueue, owner's transaction) do work, and carry one property the typed-part rail lacks: user context rendered into the prompt is disclosed by the existing receipt for free. That variant is **the recommended rail for static, user-authored classes** (profile, response preferences), under two conditions: the block stays bounded to non-sensitive user-authored text, and compaction's summarization instruction is scoped to conversation-derived preferences so profile text does not echo into a persisted checkpoint that later edits cannot reach (§4.2 objection 6). It is **not** viable for knowledge extracts or a recency digest, which fail on trust (conversation-derived text in the system role is an injection privilege-escalation primitive), on snapshot churn (every turn mints a new content-hash row holding a full prompt copy), and on prefix caching (position-0 volatility forfeits caching the entire history, not just the block). So the split is not "prompt vs part" but **static/user-authored → prompt template at bind time; volatile/derived → typed part or retrieval**, with one objection surviving for both (operator-owned, per-model injection sites cannot honor a per-user toggle). Underneath either choice: **inject cheap invariants and pointers; retrieve content.**

---

## 2. Anatomy of the source design (structure only)

Five blocks, three distinct provenances, all injected into the system-adjacent context on every turn:

| Block                           | Provenance                           | Volatility              | Notes                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User Bio**                    | User-authored (settings form)        | Static                  | Preferred name, role/stack, age, tone permission. Wrapped in an instruction acknowledging it is "not relevant to 99% of requests", with a directive to silently classify relatedness and not mention it otherwise                                    |
| **User's Instructions**         | User-authored (free text)            | Static                  | Response-style preferences. In practice a user-authored _prompt fragment_ — the observed instance contains rubric-scoring and role-play scaffolding, i.e. users will put arbitrary instruction-shaped text here                                      |
| **User Knowledge Memories**     | **Inferred** from past conversations | Slow-growing, accretive | ~8 numbered topical clusters, each a list of dated bullets: `• (YYYY-MM-DD) User stated that …`. Provenance-framed per claim; contradictions preserved explicitly ("older conflicting data point from … was …"); corrections recorded as corrections |
| **Recent Conversation Content** | Automatic, unfiltered                | Every turn              | ~40 recent conversations: timestamp, title, and message fragments with delimiters. **Not** topically filtered against the current request. Truncation markers on long chats                                                                          |
| **User Interaction Metadata**   | Auto-generated telemetry             | Every turn              | Plan tier, device/browser, country, **local hour**, account age, activity streak, average conversation depth, average message length, per-model usage percentages                                                                                    |

Three observations that matter more than the inventory:

1. **The prompt itself admits the design is wrong.** "This user profile is shown to you in all conversations — this means it is not relevant to 99% of requests" is a _relevance_ problem being patched with a _behavioral_ instruction (classify silently, don't acknowledge). Unconditional injection plus a plea for discretion is what you build when you have no retrieval at that layer.
2. **Half the metadata block cannot change any answer.** Local hour and country are genuinely load-bearing (resolving "tomorrow", answering in-country questions). Average message length, conversation depth, and model-usage percentages are telemetry that leaked into the model's context — they invite the model to reason about the user as a usage cohort. Copy the former, not the latter.
3. **Relative dates get frozen and rot.** Inferred bullets contain phrases like "passed a few months ago" pinned to an observation date, alongside superseded absolute values (a weight from over a year prior, a language self-assessment from three different dates). llame's own authoring convention already says convert relative dates to absolute — the snapshot is the empirical argument for enforcing it at _write_ time in any inferred store.

---

## 3. What llame has today (verified 2026-07-27)

- **No personalization surface at all.** `users` carries `id`, `name`, `email`, `emailVerified`, `image`, `password` — no bio, no preferences, no settings table. There is no user-context block of any kind in request assembly.
- **One packaged default prompt** (`apps/api/src/prompts/chat-default.md`, 22 lines) or a whole-file per-model override, resolved at boot from operator config.
- **A receipt model that is already better than the source's.** Every run binds an immutable owner-scoped effective-context snapshot (prompt + advertised tool contract), and owners can retrieve it on demand — host paths, provider ids, and credentials stripped (`model-system-prompts` spec).
- **A trusted-part injection rail, already shipped twice.** Model switches persist a server-authored `data-model-context` part rendered into a canonical reminder; compaction wraps its summary in a typed synthetic `conversation-checkpoint` that "identifies the content as server-generated historical context, not a new user request or higher-priority instruction."

That last sentence is the Hermes recall-time framing lesson, already in the spec, already shipped. It is the correct rail for user context, and it exists.

---

## 4. Mechanism: prompt templates vs typed parts, per content class

The `model-system-prompts` spec is explicit — each model resolves **exactly one complete** effective system prompt, and "neither prompt is inherited or composed from the other." Prompt content is **operator** config-as-code, resolved at boot, receipt-bound and content-hashed.

A user bio or preferences block is **tenant data**, per-user, mutable at any time. Appending it to the system prompt would:

- break the one-complete-prompt / no-composition invariant;
- put user-mutable text inside an operator-authored, boot-resolved, content-addressed artifact (snapshot reuse is keyed on content within an owner — mixing per-user mutable text into it is a cache-correctness problem, not just a stylistic one);
- silently widen the system-prompt trust level to cover text a user typed, which is the classic instruction-hierarchy mistake.

This maps cleanly onto llame's existing two-concerns split: **operator settings are config-as-code; tenant state is DB + RLS.** So:

```text
                     ┌─────────────────────────────────────────┐
   OPERATOR RAIL     │  llame.config.json → models[].prompt    │
   (config-as-code)  │  one complete prompt, boot-resolved,    │
                     │  receipt-bound, content-hashed          │
                     └─────────────────────────────────────────┘
                                        │  system role
                                        ▼
   ─────────────────────────────────────────────────────────────
                                        ▲  typed trusted parts
                     ┌─────────────────────────────────────────┐
   TENANT RAIL       │  user profile / preferences / memory /  │
   (DB + RLS)        │  recency digest → data-* part rendered  │
                     │  as "server-generated context, data,    │
                     │  not instructions"                      │
                     └─────────────────────────────────────────┘
```

Consequence: llame's version of "user context" is a **typed, trusted, owner-scoped part in the stream**, following the `data-model-context` / `conversation-checkpoint` precedent — not a prompt fragment. And whatever gets injected must enter the receipt, or the transparency invariant degrades to exactly the situation that produced the source snapshot.

### 4.1 Variant A: placeholders resolved at boot

Prompt files already support template expressions, so extending the vocabulary is the obvious first idea. Resolved **at boot** it cannot work at all: `createModelPromptLoader().resolve(model)` receives `Pick<PromptModel, 'id' | 'name'>` — a model, nothing else. No user, chat, or knowledge store is in scope, and there is no per-user rendering opportunity anywhere in the boot path. Dismissed on mechanics, not on design.

### 4.2 Variant B: templates rendered at snapshot-bind time (the serious proposal)

The stronger version: keep the operator template in the prompt file, render it **when the effective-context snapshot is bound** (enqueue time, in the owner's tenant transaction, where the user _is_ in scope), and let the existing snapshot system carry immutability and reuse.

This resolves most of 4.1's problems, and one of its properties is genuinely **better** than the typed-part rail:

- **Timing works.** Snapshot binding is per-run, owner-scoped, and already atomic with the user message.
- **Fail-loud survives.** The template is still operator config validated at load, so `assertSupportedPromptExpressions` still rejects an unknown placeholder at deploy time. Only the substituted _values_ arrive later.
- **The receipt comes for free.** The receipt already contains the "complete effective system prompt contents". User context rendered _into_ that prompt is disclosed verbatim with no spec extension — whereas the typed-part rail requires widening receipt scope (§9.3) to reach the same transparency. Credit where due: on this axis Variant B is the cleaner design.

Two clarifications before the objections, because they change the cost/benefit:

- **Snapshots are an integrity mechanism, not a token-cost mechanism.** Their stated purpose is that "queued execution and retry SHALL use the bound snapshot rather than rereading prompt files" — retry determinism and an immutable receipt. Reuse via the `(owner_user_id, content_hash, source)` unique index dedupes _rows_; it does not reduce tokens sent to the provider. Token cost is governed by provider prefix caching, which depends on prompt stability and position, not on snapshot identity. "Reuse unless the model changed" therefore saves a database row and a microsecond of string interpolation — not inference cost.
- **The reuse key is content, not model.** Reuse holds "unless the model changed" only for content that is otherwise static. Every distinct rendered prompt is a distinct `content_hash` → a **new row storing a full copy of the prompt text** (`system_prompt text NOT NULL`), in an append-only, immutable-by-design table.

What still breaks, and for which classes:

1. **Trust-level collapse — untouched by the refinement, and decisive for derived content.** `${knowledge}` / `${recent_chats}` substitute conversation-derived text: anything the user ever pasted, any tool output, any fetched page. Its authority comes from _where_ it lands, not _when_ it was rendered — so moving the render to enqueue changes nothing. Putting it in the system role is a privilege-escalation primitive for prompt injection, the exact inverse of the compaction checkpoint's "historical context, not a new user request or higher-priority instruction." **Applies to: knowledge extracts, recency digests, any episodic content. Does not apply to user-authored profile text.**
2. **Snapshot churn for volatile content.** A recency digest changes every turn, so every turn mints a new `content_hash` and a new row carrying a full prompt copy — dedup defeated by construction, unbounded growth in a table with no GC story. Profile and preferences change rarely and dedupe beautifully; the digest is pathological. **Applies to: volatile classes only.**
3. **Prefix-cache economics — volatile content only.** Static profile text at position 0 is perfectly cacheable, and a model change legitimately starts cold because caches are not shared across models; "reuse unless the model changed" is exactly the right behavior for static content and needs no defense. The objection is narrower and sharper: **volatile** content at position 0 diverges the prefix at roughly the first hundred tokens, which forfeits caching on the _entire history_ — the largest and fastest-growing part of a long chat's request — not merely on the block itself. The same content placed immediately before the user turn keeps system prompt plus all history inside the cached prefix and leaves only the short tail uncached (confidence: high — automatic prefix caching keys on the longest shared prefix). A secondary, low-materiality note for anything user-editable: profile text at position 0 means one bio edit cold-starts every existing chat, whereas a late block invalidates only the tail. Profile edits are rare, so this is a footnote, not an argument.
4. **Operator-owned injection sites can't carry per-user semantics.** Prompt files are operator config and prompts are **per-model**. A user's profile reaches their chats only if the operator typed the placeholder — and a model switch moves to a different prompt file, silently dropping user context if that override omits it. A per-user opt-out (§8.6) is unimplementable when the injection point lives in operator config. **Applies to every class**, and it is the one objection that survives even for profile text.
5. **Provenance label narrows.** `source` records where the prompt _file_ came from (`project_default` / `model_override`); it would no longer describe what the prompt _contains_. Fixable with an extra field, listed for completeness rather than as a blocker.
6. **Mutable prompt content becomes immutable history via compaction.** Verified in code: `compaction.service.ts` passes the bound snapshot's system prompt as the summarization call's `system`, matching the spec's "exact bound effective top-level system prompt". That verbatim replay is **deliberate and correct** — it keeps the provider cache hot across a call whose input is the entire conversation, so the summarization is practically "summarize everything above" appended to an already-cached prefix. Changing the system prompt for the summarization call to strip user context would diverge the prefix at position 0 and make that whole large call cold; that mitigation costs more than it saves and is rejected.

   The objection is therefore not about prompt reuse. It is that Variant B routes **user-mutable** content through a mechanism that converts prompt content into **append-only message content**: the summarizer sees the profile, the instruction it is given explicitly requests a **`Constraints and Preferences`** section, and anything echoed there is wrapped in a `conversation-checkpoint` that is persisted and replayed as history from then on. The channel is certain; whether a given model echoes the text is model-dependent. Once it happens, a later profile edit or deletion cannot reach it — the stale version keeps being replayed, and it wins by being in history.

   **Severity depends entirely on what the profile block is allowed to contain,** which is a policy llame controls. Bounded to non-sensitive, user-authored, low-cardinality text (name, role, tone permission, response preferences) — which §5 and §8 already require, with sensitive and inferred material living in the vault behind retrieval — the realistic failure is a stale tone preference echoed in history: a correctness and hygiene defect, not a data-protection one. That is tolerable. It stops being tolerable the moment the block widens to inferred or sensitive content, which is an independent reason to keep those classes on the retrieval rail.

   **Mitigation (cheap, no cache impact):** scope the summarization instruction's section to conversation-derived preferences — "Constraints and Preferences _stated by the user in this conversation_" — so system-prompt-derived profile text is out of scope by construction. This depends on model compliance rather than being structurally enforced, which is a genuine step down from llame's usual posture (RLS over app checks, typed parts over prose framing, fail-loud over silent fallback). The typed-part rail avoids the failure mode structurally because a block positioned after the compactable prefix is not in the summarization input at all. That structural-vs-compliance tradeoff, not severity, is the real decision here.

Two consequences of Variant B's persistence model worth stating separately:

- **The snapshot table becomes a retained archive of every version of the user's bio.** Rows are immutable by design, store the full prompt text, and have no purge path; one row per distinct profile version accumulates indefinitely. §8's delete semantics currently address the knowledge vault, not this.
- **The recommendation below runs two injection rails at once** (template for static classes, typed part for volatile). That is the right call on the merits, but two mechanisms for one concern is a real cost — accepted deliberately here, and recorded so a later reader does not "simplify" it back to one rail without re-deriving why the classes differ.

**Verdict on Variant B:** **adopt it for the static, user-authored classes** (profile, response preferences). The receipt-for-free advantage is real, the churn and cache objections do not bite for static content, and objection 6 reduces — under a content policy that keeps the block non-sensitive — to a stale-preference echo that a scoped summarization instruction largely mitigates. Two conditions attach: the profile block stays bounded to non-sensitive user-authored text (never inferred or sensitive material), and objection 4 gets an explicit answer — whether the packaged default prompt carries the placeholder, and what happens when an operator override omits it while a user has profile data.

Not viable for knowledge extracts or the recency digest, on independent grounds each: trust (conversation-derived text in the system role), snapshot churn (a per-turn digest mints a full-prompt row every turn in an append-only table), and prefix caching (position-0 volatility forfeits caching the entire history). Those stay on the typed-part and retrieval rails.

### 4.3 What to do instead — and where templating legitimately lives

The rail exists and is already exercised: `renderModelSwitchReminder` (`apps/api/src/chats/model-context-part.ts`) is a **server-owned canonical template** that renders a validated typed part into a `<system-reminder>` block, passing every substituted value through `escapeXmlAttribute`, positioned immediately before the triggering user text. That is the mechanism the question is reaching for — templating owned by the server at a defined trust level, not placeholders in an operator-editable file.

So: templates, yes — but as a **renderer function over a typed part**, with the same three properties the switch reminder already has (strict shape validation on authoring, escaping on substitution, explicit framing prose the operator cannot edit away). Extending an operator-facing customization surface later is a separate decision with its own escaping story, and must never be able to remove the data-not-instructions framing.

The second half of the answer is that **"knowledge / chats / etc." is not one thing** and must not share one mechanism. Split by size and volatility:

| Class                                    | Size                   | Volatility | Mechanism                                                                                     |
| ---------------------------------------- | ---------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| Profile (name, role, tone permission)    | tiny, capped           | rare       | **Inject** — rendered into the context block every turn                                       |
| Response preferences                     | small, capped          | rare       | **Inject** — but framed as owner-authored instructions of bounded authority, not as data (§5) |
| Ambient (current time, timezone, locale) | ~1 line                | every turn | **Inject** — computed per request, no storage                                                 |
| Recency digest (titles + dates + ids)    | capped list, no bodies | every turn | **Inject** — see §6; awareness only                                                           |
| Knowledge / memory extract               | unbounded              | grows      | **Retrieve** via tool call — inject at most a one-line pointer that it exists                 |
| Episodic chat content                    | unbounded              | —          | **Retrieve** via `search_conversations` (already shipped)                                     |

The discipline in one sentence: **inject cheap invariants and pointers; retrieve content.** Every row that is unbounded or conversation-derived belongs behind a tool call, where it is RLS-scoped, auditable, bounded, and framed on arrival. Substituting any of those into a prompt template is how the source design ended up injecting ~40 conversations into every turn.

Resulting assembly order (extending what `model-system-prompts` already specifies — the new element is one slot, not a new layer):

```text
  system   │ model's boot-resolved effective prompt        (operator, unchanged)
           │ portable prior user/assistant history
           │ conversation-checkpoint, if compacted         (typed, framed as data)
  NEW  ──▶ │ user-context block                            (typed, framed, escaped, receipted)
           │ model-switch reminder, if any                 (typed, framed)
  user     │ the triggering user text
```

Placing the block in the same slot as the existing reminders is what keeps the prefix cacheable (4.1 §5), keeps operator prompt authority intact (§4), and reuses validation and escaping that already ship.

---

## 5. Block-by-block assessment for llame

| Block                                      | Verdict                  | Rail                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User profile (name, role, tone permission) | **Take**                 | Tenant DB, typed part                      | Highest value per token in the whole snapshot. Small, static, user-authored, trivially auditable. Needs a length cap                                                                                                                                                                                                                                                                                      |
| Response preferences                       | **Take, with a caveat**  | Tenant DB, typed part                      | Users _will_ write instruction-shaped text here (the observed instance contained rubric and role-play scaffolding). It must be framed as owner-authored preference, never merged into the system role — an owner instructing their own assistant is legitimate, but it must not inherit operator-prompt authority or survive into contexts where it could override a tool-permission or safety constraint |
| Inferred knowledge memories                | **Adapt**                | The planned Markdown/Git vault (#213/#212) | llame's planned substrate is _better_ than the source's on every axis that matters: user-editable, diffable, revertible, greppable. Adopt the source's **format** discipline — dated observations, per-claim provenance framing, superseded values preserved not overwritten, absolute dates only. Reject its opacity                                                                                     |
| Recent conversation dump                   | **Reject as-is; see §6** | —                                          | The expensive, surprising, injection-exposed one                                                                                                                                                                                                                                                                                                                                                          |
| Interaction metadata                       | **Split**                | Ambient context, computed per request      | Take current time + timezone + locale/country. Drop plan tier, device, account age, activity streaks, message-length and model-usage statistics — none of it changes a correct answer, and it invites cohort reasoning about the user                                                                                                                                                                     |

### 5.1 Field-level sweep of comparable products (surveyed 2026-07-27)

What the field inventory actually looks like across hosted and self-hosted products:

| Product                                                                                                                                                                                           | Fields offered                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ChatGPT** ([help](https://help.openai.com/en/articles/11899719-customizing-your-chatgpt-personality), [OpenAI Academy](https://openai.com/academy/personalization/))                            | "What should ChatGPT call you?"; "What do you do?" (occupation); "What traits should ChatGPT have?" (suggested: Chatty, Witty, Opinionated, Encouraging); "Anything else ChatGPT should know?"; plus a separate **Base style and tone** preset (Default, Professional, Friendly, Candid, Quirky, Efficient, Nerdy, Cynical). ~1,500 chars per field. Explicitly separate from Memory                                              |
| **Claude** ([support](https://support.anthropic.com/en/articles/10185728-understanding-claude-s-personalization-features), [styles](https://www.anthropic.com/news/styles))                       | "What should Claude call you?"; "What best describes your work?"; "What preferences should Claude consider in responses?" (free text). **Styles** kept as a deliberately separate axis (Normal/Concise/Explanatory/Formal, plus custom styles built from a writing sample), documented as: preferences = account-wide context, project instructions = per-project, styles = formatting and delivery                               |
| **Perplexity** ([help](https://www.perplexity.ai/help-center/en/articles/10352990-account-settings), [profile FAQ](https://hub-prod.perplexity.ai/hub/technical-faq/what-does-the-ai-profile-do)) | Introduce yourself (bio); preferred formatting; personal interests; communication style; goals; **preferred language**; **location** (optional); special conditions                                                                                                                                                                                                                                                               |
| **Open WebUI** (verified in checkout: `backend/open_webui/models/users.py`)                                                                                                                       | Profile columns: `name`, `username`, `bio`, `gender`, `date_of_birth`, **`timezone`**, profile/banner images, presence and status fields, plus freeform `info` and `settings` JSON. Separate `memories` table typed `user` \| `context`. Injection budgets `MEMORIES_CONTEXT_CHAR_LIMIT` / `MEMORIES_USER_CHAR_LIMIT`, both defaulting to **2000 chars** ([docs](https://docs.openwebui.com/features/chat-conversations/memory/)) |
| **LibreChat** ([docs](https://www.librechat.ai/docs/features/memory))                                                                                                                             | Structured key/value user memory with **operator-defined valid keys** (e.g. `user_preferences`, `learned_facts`, `personal_information`), a memory agent running per request, and a `personalize` flag giving users control                                                                                                                                                                                                       |

Four things worth taking from the sweep:

1. **The universal core is small and consistent.** Every product ships: how to address the user, what they do, a free-text "anything else", and response/communication preferences. Everything beyond that is product-specific.
2. **Open WebUI decouples injection from tools** — memory injection can be turned off _independently_ of the memory tools, so the model can still read and write memories on request without anything being auto-added to the prompt. That is precisely the "inject pointers, retrieve content" split in §4.3, already shipped by the closest self-hosted comp. Strong independent validation.
3. **Explicit character budgets are the norm, and the number is ~1,500–2,000.** ChatGPT caps per field, Open WebUI caps per injected category. llame should cap the whole block, not each field.
4. **ChatGPT documents its own precedence bug.** Its help text concedes that a saved memory conflicting with a personality preset "may override or reduce the visible traits", and community guidance warns that a months-old inferred fact can quietly beat an explicitly written custom instruction. That is what happens when three layers (instructions, preset, memory) are injected without a stated precedence. llame should fix this by **writing the precedence down before the third layer exists**, not after.

### 5.2 Recommended field set for llame

Deliberately narrower than the sweep. Every field is injected on every turn, free-text fields collapse into each other in practice (users put everything in "anything else"), and personalization breadth is not llame's differentiator:

| Field                  | Shape                 | Rationale                                                                                                                                     |
| ---------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `display_name`         | short text, ~64 chars | "What should llame call you" — universal across all five products                                                                             |
| `about`                | free text             | Role, work, domain context, **and languages** as prose. Merges ChatGPT's occupation + "anything else"                                         |
| `response_preferences` | free text             | How to answer. Merges Claude's preferences and ChatGPT's traits                                                                               |
| `timezone`             | IANA string           | Correct date reasoning ("tomorrow"). The one field here that **code** consumes. Open WebUI carries a column; ChatGPT infers it from telemetry |

**Why `languages` is prose, not a structured field.** §7 argues a language profile is retrieval metadata rather than decoration, and that stands — but "capture the language facts" does not imply "give them a typed column." Structure is earned only when **code** consumes the value, and nothing in the near term does: fanning a query out across languages is a decision the _model_ makes (it calls a one-string tool N times), and free text in `about` — "native Russian, answer in English, also writes Spanish" — tells it everything it needs. The only code-consuming use is a ranking prior in the phase-3 embedding work, which sits in the deferred backlog; adding a typed field now to serve a deferred phase is speculative structure, and it can be added or derived when that phase lands. `timezone` is the counter-example that earns its shape, because date rendering is code rather than model judgement.

Explicitly **not** in a first version, with reasons:

- **Traits / tone presets** (ChatGPT's model). A preset axis duplicates `response_preferences` and creates exactly the precedence conflict ChatGPT documents. If presets are wanted later, follow Claude and model them as a separate, explicitly-scoped delivery axis — not a second free-text field competing for the same authority.
- **Interests and goals** (Perplexity). These are knowledge, not preferences; they belong in the vault behind retrieval, where they cost nothing when irrelevant.
- **Location** (Perplexity). Privacy-loaded, and llame has no local-search feature to justify it. Timezone covers the legitimate use.
- **Gender, date of birth** (Open WebUI). No consuming feature; pure liability in a block that gets injected everywhere.
- **Presence, status, avatars.** Social features, unrelated to context assembly.

### 5.3 Size: two categories, not one cap

Hosted products cap tightly (ChatGPT ~1,500 chars per field, Open WebUI 2,000 per injected category) because **they** pay for the tokens. Self-hosting inverts that incentive — the owner pays their own bill — so a low ceiling is paternalism imported from a different business model. Two llame-specific constraints still make _some_ bound real, and neither is about cost:

- every distinct rendered prompt is a full-text snapshot row (§4.2), so a large block multiplies stored bytes per version;
- the system prompt counts against the context window, and compaction triggers at `contextWindowTokens × 0.8`, so a large standing block permanently shrinks usable conversation length.

That argues for **generous per-field caps in the low kilobytes** plus **cost transparency in the settings UI** ("this adds ≈N tokens to every message") rather than a tight character limit. Show the number and let the owner decide; that is both the self-hosted posture and more honest than an arbitrary ceiling.

The deeper point is that a `CLAUDE.md`-scale document is **a different category**, not a bigger version of the same one. Files like that are agent _operating instructions_ — persona, workflow rules, coding standards — much closer to llame's operator system prompt or to Claude's per-project instructions than to "call me Leo, be terse." Cramming them into a settings textarea is exactly what LibreChat users complained about (model instructions and user facts mixed in one box), and it is the wrong shape regardless of the cap.

The file-first instinct is right for that category, and llame's roadmap already supplies the substrate: the personal Markdown/Git vault (#213/#214) gives version-controlled, diffable, editor-editable user documents. What the vault as specified does _not_ supply is an **always-injected** designation — it is read/search, i.e. retrieval, whereas operating instructions must be unconditionally present. Designating one vault file as always-injected is a small additional concept on an existing substrate, and it is the natural home for `CLAUDE.md`-scale content.

Sequencing, so this does not become scope creep: ship the DB-backed fields now (small, unblocked, covers the common case) and design them so a vault-file source can supplement or supersede them later without a migration of meaning. Personalization must not be blocked behind the vault milestone.

### 5.4 Naming: personalization, not "user settings"

The table and the capability should be named for **personalization** (or user context), not `user_settings`. The latter is a junk-drawer name that will attract UI theme, notification preferences, default model, and keyboard shortcuts — none of which share this data's properties: these fields enter model context, need size discipline, need receipt coverage, and carry the compaction-leak concern of §4.2. A renderer that walks a generic settings bag eventually serializes `theme: dark` into a prompt.

Industry vocabulary agrees: ChatGPT's UI section is "Personalization", Anthropic documents "Claude's personalization features", Open WebUI ships "Memory & Personalization". Reserving `personalization` for model-facing user context leaves a clean, separate home for ordinary application preferences if they are ever needed.

### 5.5 Precedence, stated before the third layer exists

The one durable design rule the sweep argues for, given ChatGPT's documented failure:

```text
  operator system prompt          ← highest; never overridable by user content
  tool permissions / safety       ← never overridable by user content
  in-conversation instructions    ← wins within its conversation
  explicit user preferences       ← standing default
  inferred memory (later)         ← LOWEST; must never silently beat an explicit preference
```

The load-bearing line is the last one: inferred memory ranking **below** explicitly authored preferences is the fix for the failure ChatGPT ships today. Writing it down now costs nothing; retrofitting it after a memory store exists means changing behavior users already depend on.

### 5.6 Trajectory: how these fields relate to a future `AGENTS.md` / `USER.md` / `SOUL.md` family

The natural expectation is that DB-backed fields are a stopgap later replaced by files. That is only true for a small part of it, because the file family in common use is **not one concept** — those filenames map onto three different llame concerns, and only one of them overlaps the fields in §5.2:

| File (by convention) | What it actually holds                                                | llame home                                                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOUL.md`            | The assistant's persona, voice, values                                | The **operator system prompt** (config-as-code, per-model) — already shipped. A _user-level_ persona override would be a new capability that directly competes with operator authority, so it needs an explicit precedence decision before it exists                  |
| `AGENTS.md`          | Scoped operating instructions: workflow rules, standards, conventions | **Per-project instructions.** llame has Projects, but they are purely organizational today (verified: the `projects` spec has no instruction, prompt, or context concept). This is a new capability on an existing container — not a supersession of anything in §5.2 |
| `USER.md`            | Durable facts about the user                                          | `about` today; a vault file later. **The one genuine overlap**                                                                                                                                                                                                        |
| `MEMORY.md`          | Accumulated or inferred facts                                         | The vault plus retrieval (#212/#213), ranked lowest by §5.5                                                                                                                                                                                                           |

Three consequences for how v1 should be shaped:

1. **For the overlapping slot: supersede, never merge.** If a vault file exists for a slot, it replaces the DB field wholesale, and the settings UI shows the field as provided-by-file (read-only, with a pointer) rather than editable. Merging two sources for one concept is the failure mode where a user edits the form, nothing changes, and there is no way to tell which source won. One slot, one source, visible provenance.
2. **Some fields never move to files.** `display_name` and `timezone` are structured and code-consumed — parsing a timezone out of Markdown is strictly worse than a column. These stay in the database permanently regardless of how far the file-first direction goes.
3. **The DB path is not a stopgap, it is the accessible path.** llame targets households and teams, so not every user will have a provisioned vault, a Git workflow, or any desire to edit Markdown. Files are the power-user surface; the settings form is the default one. That is a permanent split, not a migration — which is also why designing §5.2 as throwaway would be a mistake.

Standing risk to name now: this direction trends toward many layers — operator prompt, user persona, project instructions, user facts, preferences, inferred memory. §5.5's ladder covers _authority_ but not _scope_; when project instructions land, the ladder needs a scope dimension (instance → user → project → conversation) or llame reproduces ChatGPT's documented precedence bug with more layers to be confused about.

### 5.7 Evidence that layered composition is safe — and what buys the safety (OpenClaw)

OpenClaw composes its system prompt from many layers and does it successfully, which is the counterweight to §4's caution about composition. `buildConfiguredAgentSystemPrompt` (`src/agents/system-prompt-config.ts`) gathers owner display, TTS hints, model aliases, memory-citation mode, filesystem policy, and subagent delegation mode before rendering; provider and hook contributions merge in on top. So "these can coexist" is empirically right. But the safety is purchased by three specific disciplines, not by free-form concatenation:

1. **An explicit cache boundary as a first-class concept.** `ProviderSystemPromptContribution` (`src/agents/system-prompt-contribution.ts`) splits every contribution into `stablePrefix` — "inserted above the system-prompt cache boundary … to preserve KV cache reuse across turns" — and `dynamicSuffix`, "inserted below the cache boundary … **only** for genuinely dynamic text." The assembly path imports `ensureSystemPromptCacheBoundary` to enforce it. This is the same static-versus-volatile axis derived in §4, expressed as an architectural seam _inside_ the prompt rather than as a choice between rails — a cleaner formulation, and one llame could adopt. Note the boundary does **not** dissolve §4.2's objection 3: the documented use for `dynamicSuffix` is text that varies "across runs or sessions", not per turn, and content placed there still precedes history, so anything changing every turn still invalidates the history cache. It refines the conclusion rather than reversing it.
2. **Named, enumerated section overrides — replacement, not merging.** `sectionOverrides` accepts whole rendered sections for an explicit union of ids (`interaction_style`, `tool_call_style`, `execution_bias`), heading included. This is exactly §5.6's "supersede, never merge" implemented as a mechanism, and it is the concrete answer to "the user must be able to override behavior and persona": enumerate which sections are overridable and replace them wholesale, rather than allowing arbitrary prose to be spliced anywhere.
3. **Observability and stability tests as a standing cost.** The subsystem ships `system-prompt-report.ts` (what actually got assembled) plus dedicated stability tests — `system-prompt.ts` is ~1,450 lines against ~67 KB of tests. That ratio is the honest price of composition at this scale, and a good reason to defer it. llame already has the observability half in the effective-context receipt.

**Cheap now, expensive later.** The one thing worth doing in v1 rather than deferring: render the personalization block as a **named section** rather than as anonymous prose. Doing so costs nothing today and is precisely what makes a section-override mechanism possible later without re-cutting the prompt. Everything else here — user persona overrides, project scope, a boundary-aware contribution API — is correctly a later concern.

---

## 6. The recency dump: what it buys, what it costs, and the middle path

**What it buys is real, and llame's design does not currently buy it.** In the source conversation the assistant answered a general question with a detail from a _different_ chat, and got it right — because the fragment was simply present. llame's equivalent requires the model to _decide_ to call `search_conversations`, and a model that doesn't know a relevant chat exists has no reason to look. Retrieval-only recall systematically under-fires. This is the honest weakness of the #198 design and it should be named rather than argued away.

**What it costs:**

- **Tokens, every turn.** ~40 conversations with message fragments is a large fixed tax on every request, most of it irrelevant — the same relevance problem §2 flagged, at the largest scale in the snapshot.
- **Privacy surprise.** The user's reaction in the source transcript was _"how do you know about that?"_ — a legitimate question that took several turns to answer. Ambient injection with no visible surface is a trust defect, not a feature.
- **Prompt-injection exposure.** Raw prior-conversation fragments enter the context **unframed**. Anything that ever landed in a chat — pasted documents, tool output, content from a shared chat — becomes latent instruction-shaped text in a privileged position. llame's compaction checkpoint already demonstrates the correct treatment (typed wrapper, explicit "this is historical data, not a request"); the gbrain and Hermes deep dives both converge on the same rule. Any llame recency surface must inherit that framing, and llame's episodic corpus boundary (no system prompts, no tool payloads, no reasoning) already excludes the worst of it — a real advantage worth preserving.

**Middle path — a bounded recency digest, titles and dates only.** Inject a small, capped list of recent chat _titles_ with dates and ids; no message bodies. Properties:

- Cheap and bounded — tens of tokens per entry, not hundreds; a fixed cap rather than a fraction of history.
- Nearly injection-inert — titles are short, model-generated, and (per the chat-search work) already excluded from the tool/reasoning corpus. Still framed as data.
- **It restores the missing signal without the dump:** the model sees _"Ear canal odor — 20 Jul"_ and now has a reason to call `search_conversations`. Awareness comes from the digest; content comes from retrieval, which stays RLS-scoped, auditable, and bounded.
- Cross-lingual bonus: a mixed-language title list makes the corpus's multilingual nature visible to the model, which supports the query fan-out in §7.

Costs to weigh honestly: titles are lossy (a badly-titled chat stays invisible), it is still unconditional injection (so it must appear in the receipt and be user-disableable), and it partially overlaps what the UI already shows the human. Sizing and whether it earns its tokens is an eval question, not an argument to settle in prose.

---

## 7. The cross-lingual connection: a language profile makes fan-out deterministic

The source's inferred-knowledge block contains, among the first things it recorded, an explicit **language profile**: preferred response language, native language, self-assessed proficiency, languages in daily use, and a language currently being learned. That single structured fact is what the [cross-lingual recall note](../chat-search/2026-07-27-cross-lingual-recall.md) §6.1 was missing.

That note proposed hardcoding a hint into the `search_conversations` description ("chats may be in English, Russian, Spanish — retry translated"). With a per-user language profile the same mitigation becomes **data-driven**: the languages come from the user's own profile rather than a hardcoded guess, so fan-out targets the languages that user actually writes in, and the hint costs nothing for a monolingual user. It also gives the phase-3 embedding work a legitimate ranking signal (a user's daily languages are a prior over which chats are plausible targets) — strictly a _ranking_ signal, never a filter, per the recency-as-ranking-only rule from the gbrain dive.

This is the strongest single argument in this document for a user-profile block existing at all: it is not cosmetic personalization, it is retrieval metadata.

---

## 8. Security, privacy, and transparency requirements this raises

Any llame user-context surface inherits llame's tenancy invariants and adds new ones:

1. **Owner-scoped at the datastore.** Profile, preferences, memories, and digest state are tenant data — RLS `ENABLE` + `FORCE`, owner policy, no public-read (a public/shared chat must never expose its owner's profile or digest). Cross-tenant negative tests in the RLS harness, same as every other chat table.
2. **Everything injected appears in the receipt.** The receipt currently covers the prompt and the tool contract. If user context is injected, the receipt must include it verbatim — otherwise llame reproduces the exact defect that produced the source snapshot: a user unable to find out why the assistant knew something. This is llame's differentiator; degrading it silently would be worse than not shipping the feature.
3. **Framed as data, never as instructions.** Reuse the `conversation-checkpoint` precedent's language. Inferred/recalled content especially — Hermes's recall-time sanitizing (strip attacker-injected framing from recalled content, mark it explicitly as recalled data) is the reference implementation, and it applies to memories and digests, not just search results.
4. **Sensitive-data classes need a deliberate answer before any _inferred_ store ships.** The source's memory store accumulated health conditions, medication doses, salary, immigration status, tax history, and relationship distress — as a _side effect of ordinary conversation_, with no per-item consent and no visible inventory at write time. A self-hosted deployment changes the threat model (the operator may be the user) but does not remove it: household and small-team installs mean an operator with database access is often _not_ the subject. Concrete implications: user-visible inventory, per-item delete, no inference-by-default without an explicit opt-in, and — because the planned substrate is a Git-backed vault — a documented answer for what "delete" means when history is version-controlled. Deletion must survive rebuild (the gbrain forget-path lesson).
5. **Preferences must not escalate.** Owner-authored preference text sits above the assistant's default behavior but strictly below operator prompt authority and any tool-permission or safety constraint. Worth stating explicitly before a preferences field exists, because the natural implementation (concatenate into the prompt) violates it.
6. **User-disableable, per surface.** Profile, memory recall, and recency digest should be independently switchable by the owner. Ambient context that cannot be turned off is the thing users resent about the source design.

---

## 9. Implications for spec/issues (NOT applied — exploration only)

If/when adopted:

1. **New capability, not an extension of `model-system-prompts`.** User context rides the tenant rail (typed trusted parts), not the operator prompt. Naming it as part of the prompt capability would invite exactly the composition mistake §4 rules out.
2. **`users` needs a companion settings surface** (profile + preferences + per-surface toggles) with RLS, an egress allowlist mirroring `toPublicUser`, and a DTO/response type per the code-first OpenAPI convention.
3. **Receipt scope extension** in `model-system-prompts`: the receipt must enumerate injected user-context parts, or the transparency requirement quietly narrows.
4. **`search_conversations` language fan-out becomes profile-driven** rather than hardcoded — supersedes the [cross-lingual note](../chat-search/2026-07-27-cross-lingual-recall.md) §6.1 as stated there.
5. **Recency digest is its own evidence-gated decision** (§6): titles-only, capped, framed, receipted, disableable — and worth an eval (does the model's `search_conversations` fire rate and answer quality actually improve?) rather than shipping on intuition.
6. **The inferred-memory format discipline** (dated observations, per-claim provenance, superseded-not-overwritten, absolute dates only) belongs in the #212/#213 knowledge work as authoring rules, independently of anything in this document shipping.
