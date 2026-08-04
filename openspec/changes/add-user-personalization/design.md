## Context

llame has no personalization surface: `users` holds only auth fields, and no user-authored text reaches model context. Adding one runs into an existing hard constraint — `model-system-prompts` requires that each configured model resolve **exactly one complete** system prompt, and that "neither prompt is inherited or composed from the other." Prompt content is operator config-as-code, and `createModelPromptLoader().resolve(model)` currently receives only `{ id, name }` and returns finished text. There is no user in scope at boot.

Meanwhile llame already owns three mechanisms this change can reuse rather than reinvent: immutable owner-scoped effective-context snapshots bound at enqueue inside the owner's tenant transaction (`model_context_snapshots`, content-addressed per owner via `(owner_user_id, content_hash, source)`); an owner-only context receipt that discloses the complete effective prompt; and an established pattern for server-authored trusted content rendered with escaping (`renderModelSwitchReminder` / `escapeXmlAttribute` in `apps/api/src/chats/model-context-part.ts`).

This change **depends on** `adopt-handlebars-prompt-templates` (shipped and archived), which replaced the bespoke `${...}` grammar with Handlebars, established the boot-time AST allowlist, the narrow escaping, and the requirement that render context be a hand-built projection rather than a record. This change extends that allowlist with per-user paths and adds the data behind them; it introduces no templating mechanism of its own.

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
- Per-model activation reporting, and a rendered-token estimate (see D3, D6).
- A `timezone` field (see D2a).
- A recency / recent-chats digest — evidence-gated, needs an eval first.
- Knowledge-vault sourcing or always-injected vault files (#212/#213), user persona overrides, project-scoped instructions, and tone presets.
- Structured language fields, location, interests, goals, or demographic fields.

## Decisions

### D1: Rendering moves from boot to the run; the catalog carries a template

Per-user paths are validated as allowlisted identifiers at boot but resolved when the snapshot is bound, from a context projected under the owner's tenant scope.

This is not a small addition — it inverts when rendering happens. Today `config-loader.ts` calls `promptLoader.resolve(model)` once during config load and stores a finished string on `SystemModelCatalogEntry.systemPrompt`; no template survives past boot. The loader will instead return `{ render(context), systemPromptSource }`, the catalog will carry that, and `resolveEffectiveContext` will render with `{ model, user }` before hashing.

The blast radius is contained, and was verified rather than assumed: the **only** consumer of the catalog's rendered prompt is `resolveEffectiveContext`. Everything downstream reads the persisted snapshot instead — `run-execution.service.ts` and `compaction.service.ts` both take `snapshot.systemPrompt`, and titling uses its own `TITLE_SYSTEM_PROMPT`, so no per-user context ever reaches the title path. `toPublicModelCatalogEntry` strips the field by destructuring-rest, so the public catalog stays safe once the omitted key is renamed.

Boot still renders each template once, with the model context alone. That preserves the existing "rendered prompt is empty" check exactly: an absent per-user context yields the minimum possible output, so a template non-empty there is non-empty for every owner — and a template whose entire content sits inside `{{#if user}}` correctly fails boot rather than producing an empty prompt for an unpersonalized owner.

Alternatives rejected. _Two-pass rendering_ (boot render for model paths, a second pass at bind for user paths) re-parses operator prose that survived pass one, and an escaped literal `\{{…}}` unescapes in pass one and then evaluates in pass two. _A sentinel and string replacement_ reintroduces a bespoke substitution grammar beside Handlebars, which is the thing this design refuses to add. _A typed message part_ (like the model-switch reminder) works but requires widening receipt scope to stay transparent, whereas template substitution is disclosed by the existing receipt for free. _Composing two prompt files_ is forbidden by `model-system-prompts`: this is a per-owner projection into one already-complete template.

### D2: Static content on the prompt rail; volatile and derived content stays off it

Only static, owner-authored text goes into the system prompt. A per-turn-varying block (a recency digest) would mint a new `content_hash` — and therefore a new row holding a full prompt copy — on every turn, in an append-only table, while also diverging the request prefix near token zero and forfeiting cache reuse across the entire history. Derived content (knowledge extracts, prior-conversation text) additionally must not occupy the system role at all, since it can carry text the user pasted or a tool returned. Those classes remain on retrieval or a typed part. OpenClaw independently arrives at the same axis via an explicit `stablePrefix` / `dynamicSuffix` cache boundary, with `dynamicSuffix` documented for text varying across runs or sessions — not per turn.

### D2a: No `timezone` field

An earlier draft included `timezone` and justified it as teaching the model "what timezone 'tomorrow' means." It cannot do that. A timezone is a **zone, not an instant**, and nothing in llame injects the current date or time — not `chat-default.md`, not `context-builder.ts`. Resolving a relative date requires a current timestamp, which is per-turn volatile and therefore barred from this rail by D2; it belongs on a typed part alongside the model-switch reminder.

Rather than ship a field that cannot do its stated job, `timezone` is deferred to the change that adds current-time injection, so its column, DTO field, cap, and validator are written once.

### D3: A prompt that references no per-user path forgoes personalization, silently

Alternatives were: fail boot when a user has personalization but the prompt references no per-user path (absurd — user data must never break startup); or auto-append the section (violates the one-complete-prompt invariant). Chosen instead: the packaged default references the per-user paths, and an override that references none simply forgoes them.

An earlier draft added a **per-model activation report** so this state was never misrepresented. That is dropped as disproportionate for this change. It required the loader to expose the set of paths each template references, a report keyed by model on the personalization response, and a UI able to render a per-model matrix — to describe a situation that only arises when an operator has replaced the packaged default. The consequence is documented instead: for such a model the owner's toggles have no effect and nothing says so. If operator-replaced prompts turn out to be common, activation reporting is additive and can arrive on its own.

### D4: No llame-owned composite value, but the packaged default ships a framed, delimited block

An earlier draft shipped a composite `${user.personalization}` rendering an llame-owned section, and a later draft removed it entirely on the grounds that operators should own all structure — including all framing prose.

Removing the composite is right; removing the framing is not. The two are different things. A **composite context value** is an element the operator cannot reshape, and it stays rejected. A **block in `chat-default.md`** is a file the operator can edit or replace, so they still own structure; llame just ships a good default.

The framing matters because of what it does structurally, not rhetorically. Per-user text lands in the system prompt — the highest-authority position a model reads. Wrapping it in a named delimiter and stating that the contents are data describing the user, not instructions, is what stops authored text from reading as operator authority. The fence is enforceable rather than decorative: rendered values escape `&`, `<`, and `>`, so authored text cannot close the block or forge a second one, which the "authored text cannot forge structure" scenario pins.

Two other mechanisms were designed and rejected on the way here, recorded so they are not reinvented. A **line-drop rule** ("omit a line whose expressions all render empty") deletes operator-authored prose that shares the line and breaks multi-line structure. **Absence markers** put llame's wording inside operator sentences, and are only defensible if applied to every absent value, at which point a bare reference stops meaning "value or nothing".

Absence is therefore expressed by the context rather than by rendering tricks, at **three levels**: a field with no value is absent; `user.personalization` is absent when disabled or wholly empty; and `user` is absent when nothing beneath it would render. The third level is what lets one `{{#if user}}` gate a whole section including its framing prose — without it, an owner who shares only their account identity would lose it to a `user.personalization` gate, while gating on nothing renders framing prose around an empty fence.

### D4a: account-identity paths — `user.name` and `user.email`

`user.name` (the account display name from `users.name`) is included because it is already known to the system, needs no storage, is low-sensitivity, and gives an operator something to address the person by when they have not set a `preferredName`.

`user.email` is **also** included, reversing an earlier draft of this decision. That draft leaned on the claim that comparable products do not inject an account email; the claim is false. Claude Code injects the operator's email into the assistant's own system context as a `userEmail` block — directly verifiable, and a shipped Anthropic product. What that draft actually had was evidence about one product category: the consumer ChatGPT snapshot has no email, and neither do Claude's or Perplexity's documented personalization fields. Agentic tools that act on a user's behalf are a different category, and llame is being built toward that category.

Both require **both** toggles: `enabled` as the master switch over all per-user context, and `shareAccountIdentity` — defaulting **false** — specifically for account-derived identity. The asymmetry in defaults is the point. `enabled` gating only authored content is free to default on, because an owner who wrote nothing renders nothing and their text works the instant they write it. Identity is different: defaulting it on means an operator referencing `user.email` retroactively moves every existing user's address to the configured provider with no action or awareness from those users. A default-false flag is the cheapest possible protection, and it costs one boolean.

**The packaged default ships both paths inside conditionals**, reversing an earlier draft that referenced neither. That draft made the operator's file edit the operative control, which meant a stock installation showed the user a toggle that did nothing — a switch that silently no-ops is worse than no switch. With the conditionals shipped, `shareAccountIdentity` is the real gate: flipping it takes effect immediately, and the decision sits with the person whose address it is. Because llame is self-hosted, the operator and the user are usually the same person anyway; the toggle is what makes the multi-user case honest without burdening the common one.

Two consequences are documented rather than designed away. In a multi-user instance, an owner enabling this sends their address to whatever provider the operator configured, including third parties with no relationship to them — so the control's copy must say where the value goes. And rendered values persist in immutable `model_context_snapshots` rows: deleting the account **does** remove them (`owner_user_id` is `onDelete: 'cascade'`), but flipping the toggle off or changing the address does not rewrite rows already bound, so a superseded value stays visible in that owner's own receipts for earlier runs. It is not erasure, and it should not be described as such.

Independently of all the above and not softened by it: a tool that needs the owner's email MUST read it from the authenticated session server-side. Prompt text is model-restatable and MUST NOT be treated as authorization identity.

### D5: `responsePreferences` is framed as bounded authority, and enforcement is structural

The packaged default's block states that preferences are owner-authored delivery preferences that do not grant capabilities or override the instructions above them. Framing alone is not the guarantee: the tool set is resolved by `resolveAdvertisedTools` (allowlisted ∩ read_only) with no personalization input, so preference text cannot widen it regardless of what the model infers. The test asserts the bound tool contract is byte-identical with and without personalization.

### D6: Concrete caps, no token estimate

Hosted products cap near 1,500–2,000 characters because they pay for the tokens; self-hosting inverts that incentive. Two llame-specific bounds are still real: snapshot rows store full prompt text per distinct version, and the system prompt consumes context window against a compaction threshold of `contextWindowTokens × 0.8`.

Caps are therefore `preferredName` 255, `about` 8000, `responsePreferences` 8000 — a worst case around 16.3k characters, roughly 4k tokens. Against a large window that is negligible; against a small local model (an 8k window compacts at 6.4k) a maxed-out profile is a serious fraction of the budget. That is the owner's own doing, and it is documented rather than prevented.

An earlier draft paired generous caps with a **rendered-token estimate** on the API, so the owner could see the cost rather than be silently limited. That is dropped. Its only consumer is a settings UI explicitly out of scope, it would be an untokenized approximation, and at caps this close to hosted-product norms the argument that made it necessary — that llame is unusually permissive and therefore owes visibility — no longer holds. It is additive later if the UI wants it.

### D7: Every compaction instruction excludes the personalization block

The compaction summarization call deliberately replays the bound system prompt verbatim so the large input stays cache-warm; changing that would make the whole call cold and is rejected. But the instruction requests a `Constraints and Preferences` section, and the replayed prompt contains the owner's rendered personalization — so a standing preference can be copied into a `conversation-checkpoint` that is persisted and replayed forever, which a later personalization edit or deletion could never reach.

The mitigation is an added exclusion in the instruction: do not carry content out of the delimited personalization block, because it is re-supplied on every request. Three details matter.

It is **syntactic, not semantic**. An earlier draft scoped the section to "preferences stated by the user in the conversation," which asks the summarizer to reason about provenance — to notice that a preference it can see came from the system prompt rather than a user turn. Naming the delimiter instead asks it only to not copy text out of a marked region, which is a far more reliable instruction. This only became possible once D4 restored the fence.

It applies to **both instructions**. `COMPACTION_INSTRUCTION` and `TRANSITION_COMPACTION_INSTRUCTION` both carry the preserve-preferences sentence and share `COMPACTION_SECTION_HEADINGS`; fixing one leaves the transition path leaking.

It costs **no cache**. The instruction is sent as the request's final user message — `compaction.ts` documents that the replayed system prompt and history are byte-identical to the turn that just ran and that "only this trailing instruction is uncached." Prefix matching runs forward from token zero, so editing the trailing message cannot disturb it. What _would_ go cold is stripping the fence out of the replayed system prompt, which is exactly why that alternative is rejected.

The `Constraints and Preferences` heading itself is unchanged: constraints genuinely stated in the conversation still belong there. This remains a model-compliance mitigation rather than a structural guarantee; it is acceptable because the content policy bounds this surface to non-sensitive owner-authored text, and the residual failure is a stale delivery preference echoed in history.

### D8: `personalization`, not `user_settings`

A generic settings bag would attract theme, notifications, default model, and shortcuts — none of which share this data's properties (entering model context, needing size discipline, needing receipt coverage, carrying D7's leak concern). The concrete failure mode is a renderer walking a settings bag and serializing `theme: dark` into a prompt. `personalization` also matches the vocabulary ChatGPT, Anthropic, and Open WebUI all use, and leaves a clean home for ordinary app preferences later.

### D9: A separate table, not columns on `users`

`users` follows the NextAuth-shaped adapter contract; extending it with product fields invites adapter friction. A separate owner-scoped table also makes "no row" the natural default, keeps RLS policy narrow, and gives the future file-sourced variant somewhere to record provenance per slot.

### D10: `/api/v1/me/personalization`

Every owner-scoped resource today is `api/v1/<resource>` (`chats`, `projects`, `models`) and takes its scope from the session implicitly, so `api/v1/personalization` would have matched convention with less to explain. `api/v1/me/personalization` is chosen anyway: it names the ownership explicitly at the URL, mirrors the existing `auth/v1/me`, and establishes a namespace for the per-user resources that follow. The cost is one new namespace pattern in the API surface.

### D11: The precedence ladder states what enforces each rung

The ladder — operator prompt and tool/safety constraints, then in-conversation instructions, then authored personalization, then future inferred memory — is worth stating, but only the top rung is enforced. Tools and permissions resolve with no personalization input (D5), asserted by test. Everything below is carried by the packaged default's framing prose and by model compliance, and is not preserved if an operator replaces that framing.

There is real tension in the middle: personalization is rendered into the system prompt, which models weight above user turns, while the ladder ranks it _below_ in-conversation instructions. The fence framing is what pushes against that, and it is the honest limit of what this change enforces. The ladder is documented primarily as a forward constraint, so a later inferred-memory capability cannot be built to outrank an explicitly authored preference.

## Risks / Trade-offs

- **Operator override silently disables personalization** → documented consequence (D3); no per-model activation report ships, so an owner's toggles can be inert with nothing saying so.
- **Personalization echoed into a persisted checkpoint by the summarizer** → D7's syntactic exclusion in both instructions, plus the content policy bounding this surface to non-sensitive text. Residual risk accepted; a structural fix would require moving off the prompt rail.
- **Context projection is extended carelessly and starts passing a record** → inherited requirement and test from the Handlebars capability; `users.password` is named in both specs as the case that must stay unreachable.
- **Snapshot table accumulates one full-prompt row per personalization version** → caps (D6) bound row size; content-addressing dedupes identical content; personalization changes rarely. Account deletion cascades these rows away; a value superseded while the account lives is not rewritten, which is documented as a limitation rather than solved here.
- **A large block shrinks usable context and pulls compaction earlier** → caps bound the worst case; the small-context-window cost is documented.
- **Preference text attempts privilege escalation** → D5: enforcement is in the independently resolved tool gate, asserted by test, not in prompt wording.
- **Moving rendering to the run path adds work per enqueue** → one template render plus one PK-indexed read per send, both outside the binding transaction, against a model call that dominates by orders of magnitude.
- **Two rails for user context long-term** (prompt substitution for static, retrieval/typed parts for volatile) → accepted deliberately; the classes differ in trust, volatility, and cache behavior, and the rationale is recorded so it is not "simplified" back into one.
- **Owner-authored text reaches the provider on every request** → inherent to the feature; mitigated by the per-user toggles, the non-sensitive content policy, and receipt visibility.

## Migration Plan

1. Add the table via `drizzle-kit generate`, then hand-append `FORCE ROW LEVEL SECURITY` (Drizzle emits `ENABLE` only) plus the owner policy, matching the existing tenant-table exceptions documented in `apps/api/AGENTS.md`.
2. Extend the allowlist constant with the per-user paths; boot validation, escaping, and the projection requirement are inherited unchanged from the Handlebars capability.
3. Change the loader to return a template, move rendering to `resolveEffectiveContext`, and follow the field rename through `SystemModelCatalogEntry`, `config-loader.ts`, `toPublicModelCatalogEntry`'s omit list, and the post-build prompt runtime contract.
4. Add the delimited, framed conditional block to `apps/api/src/prompts/chat-default.md`, including the account-identity paths.
5. Project the per-user context at snapshot bind. With no personalization row and identity withheld, `user` is absent and the whole block is omitted, so the rendered prompt is byte-identical to the same template without it and existing content-addressed snapshots continue to dedupe.
6. Update both compaction instruction constants (D7).
7. Ship the API endpoints.

Rollback: the per-user toggles disable rendering without a deploy. A full revert removes the per-user paths from the allowlist and the block from the packaged prompt; the table can remain unused and empty without affecting runs. Reverting the render-seam change is the larger piece, since it touches the catalog shape.

## Open Questions

None outstanding. The three previously open — where an activation report should live, exact per-field caps, and whether the token estimate should be tokenizer-accurate — are resolved by D3 (no report), D6 (255 / 8000 / 8000), and D6 (no estimate).
