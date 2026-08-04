## Why

llame has no personalization surface at all: `users` carries only auth fields, and nothing a user can author reaches model context. Every chat therefore starts without knowing what to call the person, what they work on, or how they want answers delivered — context that is cheap to state once and expensive to repeat every conversation.

This is also the unblocked prerequisite for later context work. A stated language profile is what turns cross-lingual recall from a hardcoded guess into user-driven behavior ([cross-lingual recall](../../../docs/research/chat-search/2026-07-27-cross-lingual-recall.md) §6.1), and this change establishes the tenant table, the injection seam, the size discipline, and the precedence rules that inferred memory and a recency digest would later reuse. Design reasoning and the surveyed alternatives are in [user-context injection](../../../docs/research/long-term-memory/2026-07-27-user-context-injection.md).

## What Changes

- Introduce owner-authored **personalization**: `preferred_name`, `about` (role/context, languages as prose), `response_preferences`, plus two global toggles — `enabled` (default **true**, gating authored content) and `share_account_identity` (default **false**, additionally gating `user.name`/`user.email`) — stored per user in a new tenant-owned table with RLS `ENABLE`+`FORCE` and no public-read.
- Extend the Handlebars prompt-template allowlist established by `adopt-handlebars-prompt-templates` with per-user paths: `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name`, and `user.email`. No second substitution mechanism is introduced.
- **Move prompt rendering from boot to the run.** The loader today renders each template to a string during config load, so the catalog carries finished text and nothing downstream holds a template. It will instead expose the compiled template, and the snapshot-bind path renders it with the owner's projected context before the prompt and content hashes are computed. Boot still renders once with the model context alone, preserving the existing non-empty-output check.
- Ship **no llame-owned composite context value** — operators own structure, labels, ordering, and framing in a prompt file they can edit or replace. The packaged default does ship a **named delimited block with authority framing**, because a fence the model can see is what keeps authored text from reading as instructions, and escaping already makes that fence unforgeable.
- Gate every per-user path behind the owner's `enabled` toggle and account identity behind `share_account_identity`, and omit absent values from the context entirely — at field level, at `user.personalization`, and at `user` itself, so one conditional can gate a whole section including its framing prose.
- **Ship the identity conditionals in the packaged default**, so an owner's toggle takes effect on a stock installation with no operator action. An operator who replaces the default with a prompt referencing no per-user path silently forgoes personalization; that is documented and accepted, not reported.
- Frame `response_preferences` as owner-authored instructions of **bounded authority**: below operator prompt authority, unable to grant capabilities or relax tool-permission and safety constraints, enforced by the tool gate receiving no personalization input.
- Instruct every compaction summarization call not to carry content out of the delimited personalization block, so prompt-resident profile text is not frozen into a persisted `conversation-checkpoint` that later profile edits cannot reach. The instruction is the request's trailing message, so this costs no prefix cache.
- Add `GET`/`PATCH /api/v1/me/personalization` with DTO validation, an explicit response type and egress allowlist, and documented per-field caps.
- Record the standing **precedence ladder**, stating which rung is structurally enforced and which are advisory, so a later inferred-memory layer cannot silently outrank an explicitly authored preference.

No breaking changes of its own: absent per-user values render empty and are omitted from the context, and existing prompts, snapshots, and receipts keep their behavior. The breaking prompt-syntax cutover belonged to `adopt-handlebars-prompt-templates`, which has shipped.

## Capabilities

### New Capabilities

- `personalization`: owner-authored profile and response preferences as tenant data — fields and caps, datastore-enforced tenant isolation, bounded instruction authority, the non-sensitive/no-inference content policy, the two global toggles, the delimited framing the packaged default ships, the read/update API contract, and the precedence ladder governing this and future context layers.

### Modified Capabilities

- `model-system-prompts`: the renderable template context gains the requesting owner's per-user paths, resolved per run rather than at boot; the bound snapshot and its owner-only receipt disclose the rendered result; and every compaction summarization instruction excludes the personalization block from the summary.
- `instance-config`: the prompt loader's allowlisted context paths gain the per-user set and the loader exposes a template rather than a boot-rendered string — boot validation still rejects any identifier outside the allowlist, while per-user values resolve per run, and the packaged default references the per-user paths inside conditionals.

## Impact

- **Schema**: new personalization table plus a `drizzle-kit` migration; hand-appended `FORCE ROW LEVEL SECURITY` (Drizzle emits `ENABLE` only), consistent with existing tenant tables.
- **Depends on** `adopt-handlebars-prompt-templates` (shipped, archived), which established the template engine, the boot-time AST allowlist, the escaping rules, and the context-projection requirement this change extends.
- **`apps/api`**: new `personalization` module (repository, service, controller, DTOs); the prompt loader returning a template instead of rendered text; `config-loader.ts` no longer rendering; `SystemModelCatalogEntry` carrying the template and `toPublicModelCatalogEntry`'s omit list following it; the per-user read and render on the snapshot-bind path in `chat-loop.service.ts`; both compaction instruction constants; `apps/api/src/prompts/chat-default.md`; the post-build prompt runtime contract.
- **Tests**: `personalization-rls.integration.test.ts` for cross-tenant and public-identity denial; unit coverage for allowlist validation, conditional rendering with absent values at all three omission levels, cap enforcement, and the context projection never exposing a record; integration coverage that a bound snapshot and receipt contain the rendered block, that two owners on one model never see each other's text, and that an override lacking every personalization expression still boots and still executes.
- **Docs**: `apps/api/AGENTS.md` (per-user context paths, gating and absence semantics, caps and their context-window cost, the migration exception, the content policy), `CHANGELOG.md`.
- **Out of scope**: all frontend work (handled separately); per-model activation reporting; a rendered-token estimate; a `timezone` field, which cannot resolve relative dates without current-time injection and is deferred to the change that adds it; recency/recent-chats digest; inferred memories; knowledge-vault sourcing and always-injected vault files; user persona overrides and project-scoped instructions.
