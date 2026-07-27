## Why

llame has no personalization surface at all: `users` carries only auth fields, and nothing a user can author reaches model context. Every chat therefore starts without knowing what to call the person, what they work on, what language to answer in, or what timezone "tomorrow" means — context that is cheap to state once and expensive to repeat every conversation.

This is also the unblocked prerequisite for later context work. A stated language profile is what turns cross-lingual recall from a hardcoded guess into user-driven behavior ([cross-lingual recall](../../../docs/research/chat-search/2026-07-27-cross-lingual-recall.md) §6.1), and this change establishes the tenant table, the injection seam, the size discipline, and the precedence rules that inferred memory and a recency digest would later reuse. Design reasoning and the surveyed alternatives are in [user-context injection](../../../docs/research/long-term-memory/2026-07-27-user-context-injection.md).

## What Changes

- Introduce owner-authored **personalization**: `preferred_name`, `about` (role/context, languages as prose), `response_preferences`, and `timezone`, stored per user in a new tenant-owned table with RLS `ENABLE`+`FORCE` and no public-read.
- Substitute personalization into the selected model's **effective system prompt at effective-context-snapshot bind time**, read under the owner's tenant scope and applied before the snapshot hashes. Not at boot — no owner is in scope there — and not by composing two prompts.
- Extend the prompt-file expression vocabulary with a **closed, enumerated** set of personalization expressions, validated at boot like existing tokens while their **values** resolve per run: a composite expression rendering llame's complete owner-personalization section, plus one expression per authored field so an operator can author the surrounding structure, labels, and ordering themselves. The packaged default uses the composite form, which omits absent fields and collapses to nothing, so a default installation can never emit a label with no content beneath it.
- The packaged project-default prompt carries the composite `${personalization}` expression. An operator `systemPromptFile` override that omits every personalization expression forgoes personalization and **MUST NOT fail startup**; the API exposes, per model, whether personalization is active so the state is never silently misreported.
- Frame `response_preferences` as owner-authored instructions of **bounded authority**: below operator prompt authority, unable to grant capabilities or relax tool-permission and safety constraints.
- Scope the compaction summarization instruction's preferences section to preferences **stated by the user in the conversation**, so prompt-resident profile text does not echo into a persisted `conversation-checkpoint` that later profile edits cannot reach.
- Add `GET`/`PATCH /api/v1/me/personalization` with DTO validation, an explicit response type and egress allowlist, generous per-field caps, a token-cost estimate for the rendered block, and a per-user enable toggle.
- Record the standing **precedence ladder** so a later inferred-memory layer cannot silently outrank an explicitly authored preference.

No breaking changes: absent personalization renders an empty section, and existing prompts, snapshots, and receipts keep their current behavior.

## Capabilities

### New Capabilities

- `personalization`: owner-authored profile and response preferences as tenant data — fields and caps, datastore-enforced tenant isolation, bounded instruction authority, the non-sensitive/no-inference content policy, the per-user toggle, the read/update API contract with activation status and token estimate, and the precedence ladder governing this and future context layers.

### Modified Capabilities

- `model-system-prompts`: a model's effective system prompt is completed **at snapshot bind** by substituting the owner's personalization section rather than being fully resolved at boot; the bound snapshot and its owner-only receipt disclose the substituted result; and the compaction summarization instruction scopes its preferences section to conversation-stated preferences.
- `instance-config`: the prompt loader accepts the closed set of personalization expressions — boot validation continues to reject unknown `${...}` expressions, including a personalization expression naming a field outside the set, while these tokens' values resolve per run instead of at startup, and emptiness is assessed with them unresolved.

## Impact

- **Schema**: new personalization table plus a `drizzle-kit` migration; hand-appended `FORCE ROW LEVEL SECURITY` (Drizzle emits `ENABLE` only), consistent with existing tenant tables.
- **`apps/api`**: new `personalization` module (repository, service, controller, DTOs); `instance-config` prompt loader and expression validator; snapshot-bind path in the run/chat assembly; `compaction` summarization instruction text; `apps/api/src/prompts/chat-default.md`.
- **Tests**: cross-tenant negative coverage in `apps/api/scripts/rls-test.sh`; unit coverage for expression validation, escaping, cap enforcement, and empty-personalization rendering; integration coverage that a bound snapshot and receipt contain the rendered section and that an override lacking every personalization expression still boots and still executes.
- **Docs**: `apps/api/AGENTS.md` (expression vocabulary, migration exception, activation semantics), `CHANGELOG.md`.
- **Out of scope**: all frontend work (handled separately); recency/recent-chats digest; inferred memories; knowledge-vault sourcing and always-injected vault files; user persona overrides and project-scoped instructions.
