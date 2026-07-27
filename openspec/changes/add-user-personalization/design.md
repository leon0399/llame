## Context

llame has no personalization surface: `users` holds only auth fields, and no user-authored text reaches model context. Adding one runs into an existing hard constraint — `model-system-prompts` requires that each configured model resolve **exactly one complete** system prompt, and that "neither prompt is inherited or composed from the other." Prompt content is operator config-as-code, read at boot by `createModelPromptLoader().resolve(model)`, which receives only `{ id, name }`. There is no user in scope at boot, and `assertSupportedPromptExpressions` rejects any unrecognized `${...}`.

Meanwhile llame already owns three mechanisms this change can reuse rather than reinvent: immutable owner-scoped effective-context snapshots bound at enqueue inside the owner's tenant transaction (`model_context_snapshots`, content-addressed per owner via `(owner_user_id, content_hash, source)`); an owner-only context receipt that discloses the complete effective prompt; and an established pattern for server-authored trusted content rendered with escaping (`renderModelSwitchReminder` / `escapeXmlAttribute` in `apps/api/src/chats/model-context-part.ts`).

This change **depends on** `adopt-handlebars-prompt-templates`, which replaces the bespoke `${...}` grammar with Handlebars, establishes the boot-time AST allowlist, the custom escaping, and the requirement that render context be a hand-built projection rather than a record. This change extends that allowlist with per-user paths and adds the data behind them; it introduces no templating mechanism of its own.

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

### D1: Resolve per-user paths at snapshot-bind time, not at boot and not as a typed message part

Per-user paths are validated as allowlisted identifiers at boot but resolved when the snapshot is bound, from a context projected under the owner's tenant scope.

- _Boot-time resolution_ is impossible — the loader has no owner.
- _A typed message part_ (like the model-switch reminder) also works and was the initial recommendation, but it requires widening receipt scope to stay transparent, whereas template substitution is disclosed by the existing receipt for free.
- _Composing two prompt files_ is forbidden by `model-system-prompts` and is not used: this is a per-owner projection into one already-complete template.

Accepted consequence: per-user context is **operator-opt-in** per model, because the reference site is an operator-owned file (see D3).

### D2: Static content on the prompt rail; volatile and derived content stays off it

Only static, owner-authored text goes into the system prompt. A per-turn-varying block (a recency digest) would mint a new `content_hash` — and therefore a new row holding a full prompt copy — on every turn, in an append-only table, while also diverging the request prefix near token zero and forfeiting cache reuse across the entire history. Derived content (knowledge extracts, prior-conversation text) additionally must not occupy the system role at all, since it can carry text the user pasted or a tool returned. Those classes remain on retrieval or a typed part. OpenClaw independently arrives at the same axis via an explicit `stablePrefix` / `dynamicSuffix` cache boundary, with `dynamicSuffix` documented for text varying across runs or sessions — not per turn.

### D3: A prompt that references no per-user path forgoes personalization, loudly reported rather than silently degraded

Alternatives were: fail boot when a user has personalization but the prompt references no per-user path (absurd — user data must never break startup); auto-append the section (violates the one-complete-prompt invariant); or fall back to a typed part (a second rail for one concern). Chosen instead: the packaged default references personalization paths, an override that references none simply forgoes it, and the **API reports activation per model** so the state is never misrepresented. Per-model prompts mean personalization can be active for one model and not another; the report is therefore per model, not a single boolean.

### D4: No llame-owned block — operators own all structure

An earlier draft shipped a composite `${user.personalization}` that rendered an llame-owned section with its own framing prose, kept because per-field substitution leaves an operator's label behind when the value is absent. That justification does not survive Handlebars: `{{#if user.personalization.about}}` omits the label with the value, so the operator gets residue-free output _and_ full control of structure. The composite's remaining rationale was that llame could guarantee a framing sentence — but `chat-default.md` already establishes instruction priority generically, and per D5 the actual enforcement is structural rather than textual. So the composite is removed: it was the one element an operator could not reshape, which is the opposite of what a config-as-code surface should offer.

Two other mechanisms were designed and rejected on the way here, recorded so they are not reinvented. A **line-drop rule** ("omit a line whose expressions all render empty") deletes operator-authored prose that shares the line — `The user prefers: {{…}} — follow this closely.` loses its instruction — and breaks multi-line structure. **Absence markers** put llame's wording inside operator sentences, and are only defensible if applied to every absent value, at which point a bare reference stops meaning "value or nothing".

Absence is therefore expressed by the context rather than by rendering tricks: a path with no value is **absent from the context**, so `if`/`unless` behave correctly and a bare reference renders empty.

### D4a: account-identity paths — `user.name` and `user.email`

`user.name` (the account display name from `users.name`) is included because it is already known to the system, needs no storage, is low-sensitivity, and gives an operator something to address the person by when they have not set a `preferredName`.

`user.email` is **also** included, reversing an earlier draft of this decision. That draft leaned on the claim that comparable products do not inject an account email; the claim is false. Claude Code injects the operator's email into the assistant's own system context as a `userEmail` block — directly verifiable, and a shipped Anthropic product. What that draft actually had was evidence about one product category: the consumer ChatGPT snapshot has no email, and neither do Claude's or Perplexity's documented personalization fields. Agentic tools that act on a user's behalf are a different category, and llame is being built toward that category. Arguing from "nobody does this" was the weak part of the position and it does not survive.

What does survive is narrower, and it turns out the architecture already handles it. **Every expression here is operator-opt-in by construction**: a value reaches a provider only if the operator wrote that expression into a prompt file. So an allowlisted `user.email` does not make emails flow; it lets an operator decide to. Operators already control prompt content completely, so this is consistent with the existing trust model rather than a new hole — and holding this one token to a stricter standard than the architecture requires was inconsistent.

Both require **both** toggles: `enabled` as the master switch over all per-user context, and `shareAccountIdentity` — defaulting **false** — specifically for account-derived identity. The asymmetry in defaults is the point. `enabled` gating only authored content is free to default on, because an owner who wrote nothing renders nothing and their text works the instant they write it. Identity is different: defaulting it on means an operator who references `user.email` retroactively moves every existing user's address to the configured provider with no action or awareness from those users, and into immutable snapshot rows with no purge path. A default-false flag is the cheapest possible protection for the one case where an operator decision reaches data users would reasonably consider theirs, and it costs one boolean. In a single-user install operator and user are the same person and it is flipped once; that friction is accepted rather than designed away.

Two consequences are documented rather than designed away, because they are real and operators should choose knowingly. In a multi-user instance, referencing `user.email` sends every affected user's address to whatever provider the operator configured, including third parties with no relationship to those users — unlike Claude Code, where the account holder, the operator, and the provider's counterparty are the same person. And rendered values persist in immutable `model_context_snapshots` rows that have no purge path and can reach the D7 compaction echo path, so an email committed this way outlives any later account change. Neither consequence is unique to email; email is simply the value where they matter most.

The packaged project-default prompt references neither account-identity path, so a default installation transmits no account identity until an operator deliberately adds one.

Independently of all the above and not softened by it: a tool that needs the owner's email MUST read it from the authenticated session server-side. Prompt text is model-restatable and MUST NOT be treated as authorization identity — that rule holds whether or not the email is also injected for the model to read.

If the email is wanted later it should arrive as its own decision: opt-in per user rather than operator-configured, with the flow-to-provider consequence documented at the point of consent.

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

- **Operator override silently disables personalization** → D3's per-model activation report; the API never claims personalization is active when the resolved template references no per-user path.
- **Personalization echoed into a persisted checkpoint by the summarizer** → D7 scoping plus the content policy bounding this surface to non-sensitive text. Residual risk accepted and documented; a structural fix would require moving off the prompt rail.
- **Context projection is extended carelessly and starts passing a record** → inherited requirement and test from the Handlebars capability; `users.password` is named in both specs as the case that must stay unreachable.
- **Snapshot table accumulates one full-prompt row per personalization version** → caps (D6) bound row size; content-addressing dedupes identical content; personalization changes rarely. No purge path exists today, and this change does not add one — noted as a known limitation rather than solved here.
- **A large block shrinks usable context and pulls compaction earlier** → D6's token estimate surfaces the cost to the owner; caps bound the worst case.
- **Preference text attempts privilege escalation** → D5: enforcement is in the independently resolved tool gate, asserted by test, not in prompt wording.
- **Two rails for user context long-term** (prompt substitution for static, retrieval/typed parts for volatile) → accepted deliberately; the classes differ in trust, volatility, and cache behavior, and the rationale is recorded so it is not "simplified" back into one.
- **Owner-authored text reaches the provider on every request** → inherent to the feature; mitigated by the per-user toggle, the non-sensitive content policy, and receipt visibility.

## Migration Plan

1. Add the table via `drizzle-kit generate`, then hand-append `FORCE ROW LEVEL SECURITY` (Drizzle emits `ENABLE` only) plus the owner policy, matching the existing tenant-table exceptions documented in `apps/api/AGENTS.md`.
2. Extend the allowlist constant with the per-user paths; boot validation, escaping, and the projection requirement are inherited unchanged from the Handlebars capability.
3. Add a conditional personalization block to `apps/api/src/prompts/chat-default.md`, referencing no account-identity path. Installations using the packaged default gain the feature; installations with a custom `systemPromptFile` are unchanged and report inactive until the operator adds the paths.
4. Project the per-user context at snapshot bind. With no personalization row the conditional block is omitted entirely, so the rendered prompt is byte-identical to the same template without it and existing content-addressed snapshots continue to dedupe.
5. Update the compaction instruction (D7).
6. Ship the API endpoints.

Rollback: the per-user toggle disables rendering without a deploy. A full revert removes the per-user paths from the allowlist and the packaged prompt; the table can remain unused and empty without affecting runs.

## Open Questions

- Should the activation report live on the personalization response, the model catalog, or both? Leaning personalization-only for now, since the catalog is public and must not gain owner-specific fields.
- Exact per-field caps within the low-kilobyte range — pick concrete numbers during implementation and document them in `apps/api/AGENTS.md`.
- Whether the token estimate should be provider-accurate (tokenizer-based) or a documented approximation. Approximation is likely sufficient for a cost hint and avoids coupling the settings path to a tokenizer.
