## Why

llame has no personalization surface at all: `users` carries only auth fields, and nothing a user can author reaches model context. Every chat therefore starts without knowing what to call the person, what they work on, what language to answer in, or what timezone "tomorrow" means — context that is cheap to state once and expensive to repeat every conversation.

This is also the unblocked prerequisite for later context work. A stated language profile is what turns cross-lingual recall from a hardcoded guess into user-driven behavior ([cross-lingual recall](../../../docs/research/chat-search/2026-07-27-cross-lingual-recall.md) §6.1), and this change establishes the tenant table, the injection seam, the size discipline, and the precedence rules that inferred memory and a recency digest would later reuse. Design reasoning and the surveyed alternatives are in [user-context injection](../../../docs/research/long-term-memory/2026-07-27-user-context-injection.md).

## What Changes

- Introduce owner-authored **personalization**: `preferred_name`, `about` (role/context, languages as prose), `response_preferences`, and `timezone`, stored per user in a new tenant-owned table with RLS `ENABLE`+`FORCE` and no public-read.
- Extend the Handlebars prompt-template allowlist established by `adopt-handlebars-prompt-templates` with per-user paths: `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.personalization.timezone`, `user.name`, and `user.email`. No second substitution mechanism is introduced.
- Resolve those paths **per run**, read under the owner's tenant scope and projected into the render context before the snapshot hashes are computed. Values are validated as allowlisted identifiers at boot but never resolved there, because no owner is in scope at startup.
- Ship **no llame-owned block, wrapper, or framing prose**. Operators own structure, labels, ordering, and framing, and use the template conditionals to omit a label together with an absent value. An llame-owned composite section was designed and rejected: it was the one element an operator could not reshape.
- Gate every per-user path behind the owner's `enabled` toggle, and omit absent values from the context entirely so a conditional over them is false. The packaged default references no account-identity path, so a stock installation transmits no account identity until an operator adds one.
- Frame `response_preferences` as owner-authored instructions of **bounded authority**: below operator prompt authority, unable to grant capabilities or relax tool-permission and safety constraints.
- Scope the compaction summarization instruction's preferences section to preferences **stated by the user in the conversation**, so prompt-resident profile text does not echo into a persisted `conversation-checkpoint` that later profile edits cannot reach.
- Add `GET`/`PATCH /api/v1/me/personalization` with DTO validation, an explicit response type and egress allowlist, generous per-field caps, a token-cost estimate for the rendered block, and a per-user enable toggle.
- Record the standing **precedence ladder** so a later inferred-memory layer cannot silently outrank an explicitly authored preference.

No breaking changes of its own: absent per-user values render empty and are omitted from the context, and existing prompts, snapshots, and receipts keep their behavior. The breaking prompt-syntax cutover belongs to `adopt-handlebars-prompt-templates`.

## Capabilities

### New Capabilities

- `personalization`: owner-authored profile and response preferences as tenant data — fields and caps, datastore-enforced tenant isolation, bounded instruction authority, the non-sensitive/no-inference content policy, the per-user toggle, the read/update API contract with activation status and token estimate, and the precedence ladder governing this and future context layers.

### Modified Capabilities

- `model-system-prompts`: the renderable template context gains the requesting owner's per-user paths, resolved per run rather than at boot; the bound snapshot and its owner-only receipt disclose the rendered result; and the compaction summarization instruction scopes its preferences section to conversation-stated preferences.
- `instance-config`: the prompt loader's allowlisted context paths gain the per-user set — boot validation still rejects any identifier outside the allowlist, while per-user values resolve per run, and the packaged default references no account-identity path.

## Impact

- **Schema**: new personalization table plus a `drizzle-kit` migration; hand-appended `FORCE ROW LEVEL SECURITY` (Drizzle emits `ENABLE` only), consistent with existing tenant tables.
- **Depends on** `adopt-handlebars-prompt-templates`, which establishes the template engine, the boot-time AST allowlist, the escaping rules, and the context-projection requirement this change extends.
- **`apps/api`**: new `personalization` module (repository, service, controller, DTOs); the prompt loader's allowlist constant and render-context projection; the per-user read and context assembly on the snapshot-bind path; `compaction` summarization instruction text; `apps/api/src/prompts/chat-default.md`.
- **Tests**: cross-tenant negative coverage in `apps/api/scripts/rls-test.sh`; unit coverage for allowlist validation, conditional rendering with absent values, cap enforcement, and the context projection never exposing a record; integration coverage that a bound snapshot and receipt contain the rendered section and that an override lacking every personalization expression still boots and still executes.
- **Docs**: `apps/api/AGENTS.md` (per-user context paths, gating and absence semantics, migration exception, activation semantics, caps, content policy), `CHANGELOG.md`.
- **Out of scope**: all frontend work (handled separately); recency/recent-chats digest; inferred memories; knowledge-vault sourcing and always-injected vault files; user persona overrides and project-scoped instructions.
