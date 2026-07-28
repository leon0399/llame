## Why

Prompt files currently support a bespoke three-token grammar (`${model.id}`, `${model.name}`, `$${model.name}`) that can substitute a value but cannot express **absence**. That limit is about to become the dominant design constraint: per-user context is next, and a value that may be unset needs the surrounding label, heading, or sentence to disappear with it. Three mechanisms were designed to avoid conditionals and each failed on a concrete example — an llame-owned composite block the operator cannot reshape, a "drop the line if its expressions render empty" rule that silently deletes operator-authored instructions sharing that line, and absence markers that put llame's prose inside the operator's sentences. The problem genuinely needs conditionals.

Every context class queued behind this one — per-user personalization, account identity, project instructions, later memory or recency surfaces — hits the same requirement. Adopting a standard template engine once, while the vocabulary is still three tokens and nothing is in production, is far cheaper than growing a bespoke grammar toward one conditional at a time. Handlebars is the native choice here; hand-rolling conditional syntax would be the reinvention.

## What Changes

- **BREAKING**: prompt files use Handlebars instead of the `${...}` grammar. `${model.id}` becomes `{{model.id}}`, `${model.name}` becomes `{{model.name}}`, and the literal escape `$${model.name}` becomes Handlebars' own `\{{model.name}}`. Hard cutover with no dual-syntax support and no deprecation window; llame is not in production use, and a stale `${...}` in a configured prompt fails startup naming the expression rather than rendering literally.
- Prompt templates are **parsed and validated at boot**, walking the compiled AST to reject anything outside a deliberately narrow subset: identifiers outside an allowlist, unescaped output (`{{{ ... }}}`), partials (`{{> ... }}`), and every helper except the built-in `if` and `unless`. Rendering itself stays lenient so a missing runtime value can never fail a run.
- Partial rejection is not stylistic: `model-system-prompts` forbids prompt fragments and inheritance, and Handlebars partials are exactly that. Adopting the engine without rejecting them would silently introduce a file-include mechanism the spec says does not exist.
- Template **context is an explicit hand-built projection**, never a database row. `users` carries a `password` column, so a row passed as context would make `{{user.password}}` render a credential hash into a system prompt, an immutable snapshot, and an owner-visible receipt. With a closed token list the boundary was the token set; with a template engine the boundary is the context object, and that shift is the security-relevant part of this change.
- **Escaping is customized rather than defaulted.** Handlebars' HTML escaping would render `don't` as `don&#x27;t` in a natural-language prompt, degrading every request that carries prose. Escaping is narrowed to the characters that could forge a structural fence while leaving ordinary punctuation intact.
- No new values are exposed to any prompt. The renderable set stays exactly `model.id` and `model.name`; only the syntax and validation change.

## Capabilities

### New Capabilities

_None. This change replaces the templating mechanism of existing capabilities without introducing new behavior of its own._

### Modified Capabilities

- `instance-config`: the prompt loader parses Handlebars templates and validates them against an allowlisted AST subset at boot, replacing `${...}` rendering and its expression checks; unsupported nodes fail startup naming the model id and the offending construct.
- `model-system-prompts`: the supported prompt vocabulary becomes Handlebars expressions over an explicit context projection, with conditionals available to operators; single-pass, non-recursive, fragment-free resolution and fail-loud startup validation are all preserved.

## Impact

- **`apps/api`**: new `handlebars` dependency, declared through the workspace `catalog:` per repo convention and pinned to a version whose prototype-property access is disabled by default; `src/instance-config/prompt-loader.ts` (parse, allowlist validation, render, escaping); `src/prompts/chat-default.md` migrated to Handlebars syntax; `src/instance-config/prompt-built-runtime.contract.ts`, the post-`nest build` gate that asserts the packaged default renders non-empty. No build-config change is needed — `nest-cli.json` already ships `prompts/*.md` as assets.
- **Tests**: `prompt-loader.spec.ts` gains coverage for each rejected construct (unknown identifier, triple-stache, partial, disallowed helper), for the literal-escape form, for lenient render of a missing value, and for the custom escaping preserving apostrophes while neutralizing fence characters.
- **Docs**: `apps/api/AGENTS.md` — the Handlebars subset, the four rejection rules, the context-projection requirement, and the breaking migration note.
- **Operator-facing breaking change**: any deployment with a custom `systemPromptFile` must migrate its expressions. Startup fails with a named error rather than silently mis-rendering.
- **Out of scope**: all per-user context. `user.name`, `user.email`, and personalization arrive in `add-user-personalization`, where the per-user opt-out gate exists — this change deliberately exposes no new data so it carries no privacy surface.
