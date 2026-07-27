## Context

llame has no personalization surface: `users` holds only auth fields, and no user-authored text reaches model context. Adding one runs into an existing hard constraint — `model-system-prompts` requires that each configured model resolve **exactly one complete** system prompt, and that "neither prompt is inherited or composed from the other." Prompt content is operator config-as-code, read at boot by `createModelPromptLoader().resolve(model)`, which receives only `{ id, name }`. There is no user in scope at boot, and `assertSupportedPromptExpressions` rejects any unrecognized `${...}`.

Meanwhile llame already owns three mechanisms this change can reuse rather than reinvent: immutable owner-scoped effective-context snapshots bound at enqueue inside the owner's tenant transaction (`model_context_snapshots`, content-addressed per owner via `(owner_user_id, content_hash, source)`); an owner-only context receipt that discloses the complete effective prompt; and an established pattern for server-authored trusted content rendered with escaping (`renderModelSwitchReminder` / `escapeXmlAttribute` in `apps/api/src/chats/model-context-part.ts`).

Full comparative analysis, the surveyed product field sets, and the rejected alternatives are in [user-context injection](../../../docs/research/long-term-memory/2026-07-27-user-context-injection.md). Frontend work is deliberately excluded from this change and handled separately, so everything the UI will eventually need is exposed through the API instead.

## Goals / Non-Goals

**Goals:**

- Let an owner author a small, bounded profile that reaches every one of their runs, on the rail llame already uses for trusted content.
- Keep operator prompt authority, tenant isolation, retry determinism, and receipt transparency exactly as they are today.
- Establish the tenant table, injection seam, size discipline, and precedence rules that inferred memory and a recency digest can later reuse without rework.
- Preserve provider prefix-cache behavior for existing conversations.

**Non-Goals:**

- Any frontend or settings UI (separate change).
- Inferred, extracted, or auto-populated memory of any kind.
- A recency / recent-chats digest — evidence-gated, needs an eval first.
- Knowledge-vault sourcing or always-injected vault files (#212/#213), user persona overrides, project-scoped instructions, and tone presets.
- Structured language fields, location, interests, goals, or demographic fields.

## Decisions

### D1: Substitute into the effective prompt at snapshot-bind time, not at boot and not as a typed message part

`${personalization}` is validated at boot as a supported expression but resolved per run when the snapshot is bound, inside the owner's tenant transaction.

- _Boot-time resolution_ is impossible — the loader has no user.
- _A typed message part_ (like the model-switch reminder) also works and was the initial recommendation, but it requires widening receipt scope to stay transparent, whereas prompt substitution is disclosed by the existing receipt for free.
- _Composing two prompt files_ is forbidden by `model-system-prompts` and is not used: this is a per-owner substitution into one already-complete prompt.

Accepted consequence: this makes personalization **operator-opt-in** per model, because the injection site is an operator-owned file (see D3).

### D2: Static content on the prompt rail; volatile and derived content stays off it

Only static, owner-authored text goes into the system prompt. A per-turn-varying block (a recency digest) would mint a new `content_hash` — and therefore a new row holding a full prompt copy — on every turn, in an append-only table, while also diverging the request prefix near token zero and forfeiting cache reuse across the entire history. Derived content (knowledge extracts, prior-conversation text) additionally must not occupy the system role at all, since it can carry text the user pasted or a tool returned. Those classes remain on retrieval or a typed part. OpenClaw independently arrives at the same axis via an explicit `stablePrefix` / `dynamicSuffix` cache boundary, with `dynamicSuffix` documented for text varying across runs or sessions — not per turn.

### D3: A prompt that omits every personalization expression forgoes personalization, loudly reported rather than silently degraded

Alternatives were: fail boot when a user has personalization but the prompt references none (absurd — user data must never break startup); auto-append the section (violates the one-complete-prompt invariant); or fall back to a typed part (a second rail for one concern). Chosen instead: the packaged default prompt ships the composite expression, an override that references none simply forgoes personalization, and the **API reports activation per model** so the state is never misrepresented. Per-model prompts mean personalization can be active for one model and not another; the report is therefore per model, not a single boolean.

### D4: Both a composite expression and per-field expressions

Per-field expressions are the primary customization surface: they let an operator author the structure, labels, headings, ordering, and framing wording themselves, and they match the grammar `${model.id}` / `${model.name}` already established rather than inventing a second style. The prompt file is llame's config-as-code customization surface, so putting the structure there — instead of behind a separate section-override API — is the consistent answer, and it subsumes what OpenClaw solves with `sectionOverrides`.

The composite expression is kept for one concrete reason, not symmetry: **empty-value structural residue**. With per-field expressions the operator's static scaffolding survives when the value does not, so an owner who filled in only their name yields a dangling `## About them:` with nothing beneath it, and an owner with no personalization at all yields a block of empty labels. Only llame-owned composition can omit absent fields and collapse to nothing. Conditional syntax (`{{#if}}`) would fix it too, but that means a template engine and breaks the single-pass, non-recursive contract — rejected. So the packaged default uses the composite form and is correct for every owner, while operators who want full control take the per-field form and own the empty case. Both are documented; neither is a fallback for the other.

Consequences worth stating: the expression set stays **closed and enumerated**, so a typo'd field name fails startup like any other unsupported expression rather than silently rendering empty. Personalization expressions break the existing template contract in one way that must be documented — `${model.name}` with no value fails startup, whereas an unset personalization value renders empty, because no owner exists at boot and owner data must never break a run. Emptiness validation is assessed with personalization unresolved, so a prompt made only of personalization expressions fails as empty at startup instead of shipping a model that can send an empty system prompt. Every substituted value passes through the existing escaping helper, and substituted text is never re-interpreted as a further expression.

Placement is the operator's choice, with one documented trade-off: values scattered through the prompt fragment the operator's stable prefix, so the portion shared across all owners of that model shrinks to whatever precedes the first expression. That costs little at the current default prompt size (roughly 400 tokens, below the threshold where automatic prefix caching engages) and matters only if an operator ships a much larger prompt — so it is a note in the docs, not a constraint.

### D5: `responsePreferences` is framed as bounded authority, and enforcement is structural

The rendered section states that preferences are owner-authored delivery preferences that do not grant capabilities or override the instructions above them. Framing alone is not the guarantee: the tool set is resolved by `resolveAdvertisedTools` (allowlisted ∩ read_only) with no personalization input, so preference text cannot widen it regardless of what the model infers. The test asserts the bound tool contract is byte-identical with and without personalization.

### D6: Generous caps plus a token-cost estimate, instead of a tight character limit

Hosted products cap near 1,500–2,000 characters because they pay for the tokens; self-hosting inverts that incentive. Two llame-specific bounds are still real and are not about cost: snapshot rows store full prompt text per distinct version, and the system prompt consumes context window against a compaction threshold of `contextWindowTokens × 0.8`. So caps are set in the low kilobytes per field and the API returns an estimate of tokens added per request, letting the owner see the cost rather than be silently limited.

### D7: Compaction's preferences section is scoped to conversation-stated preferences

The compaction summarization call deliberately replays the bound system prompt verbatim so the large input stays cache-warm; changing that would make the whole call cold and is rejected. But the instruction requests a `Constraints and Preferences` section, so prompt-resident personalization could be echoed into a `conversation-checkpoint` that is persisted and replayed forever — which a later personalization edit or deletion could not reach. Scoping the section to preferences **stated by the user in the conversation** removes personalization from its scope at no cache cost. This is a model-compliance mitigation rather than a structural guarantee; it is acceptable because the content policy bounds this surface to non-sensitive owner-authored text, and the residual failure is a stale delivery preference echoed in history.

### D8: `personalization`, not `user_settings`

A generic settings bag would attract theme, notifications, default model, and shortcuts — none of which share this data's properties (entering model context, needing size discipline, needing receipt coverage, carrying D7's leak concern). The concrete failure mode is a renderer walking a settings bag and serializing `theme: dark` into a prompt. `personalization` also matches the vocabulary ChatGPT, Anthropic, and Open WebUI all use, and leaves a clean home for ordinary app preferences later.

### D9: A separate table, not columns on `users`

`users` follows the NextAuth-shaped adapter contract; extending it with product fields invites adapter friction. A separate owner-scoped table also makes "no row" the natural default, keeps RLS policy narrow, and gives the future file-sourced variant somewhere to record provenance per slot.

## Risks / Trade-offs

- **Operator override silently disables personalization** → D3's per-model activation report; the API never claims personalization is active when the resolved prompt references no personalization expression.
- **Personalization echoed into a persisted checkpoint by the summarizer** → D7 scoping plus the content policy bounding this surface to non-sensitive text. Residual risk accepted and documented; a structural fix would require moving off the prompt rail.
- **Snapshot table accumulates one full-prompt row per personalization version** → caps (D6) bound row size; content-addressing dedupes identical content; personalization changes rarely. No purge path exists today, and this change does not add one — noted as a known limitation rather than solved here.
- **A large block shrinks usable context and pulls compaction earlier** → D6's token estimate surfaces the cost to the owner; caps bound the worst case.
- **Preference text attempts privilege escalation** → D5: enforcement is in the independently resolved tool gate, asserted by test, not in prompt wording.
- **Two rails for user context long-term** (prompt substitution for static, retrieval/typed parts for volatile) → accepted deliberately; the classes differ in trust, volatility, and cache behavior, and the rationale is recorded so it is not "simplified" back into one.
- **Owner-authored text reaches the provider on every request** → inherent to the feature; mitigated by the per-user toggle, the non-sensitive content policy, and receipt visibility.

## Migration Plan

1. Add the table via `drizzle-kit generate`, then hand-append `FORCE ROW LEVEL SECURITY` (Drizzle emits `ENABLE` only) plus the owner policy, matching the existing tenant-table exceptions documented in `apps/api/AGENTS.md`.
2. Extend the prompt-expression validator to accept `${personalization}` and defer its value; existing prompts are unaffected because the token is new.
3. Add `${personalization}` to `apps/api/src/prompts/chat-default.md`. Installations using the packaged default gain the feature; installations with a custom `systemPromptFile` are unchanged and report inactive until the operator adds the token.
4. Substitute at snapshot bind. With no personalization row, the section renders empty and the resulting prompt is byte-identical to today's apart from the removed placeholder, so existing content-addressed snapshots continue to dedupe.
5. Update the compaction instruction (D7).
6. Ship the API endpoints.

Rollback: the per-user toggle disables rendering without a deploy. A full revert removes the expressions from the packaged prompt and the substitution step; the table can remain unused and empty without affecting runs.

## Open Questions

- Should the activation report live on the personalization response, the model catalog, or both? Leaning personalization-only for now, since the catalog is public and must not gain owner-specific fields.
- Exact per-field caps within the low-kilobyte range — pick concrete numbers during implementation and document them in `apps/api/AGENTS.md`.
- Whether the token estimate should be provider-accurate (tokenizer-based) or a documented approximation. Approximation is likely sufficient for a cost hint and avoids coupling the settings path to a tokenizer.
