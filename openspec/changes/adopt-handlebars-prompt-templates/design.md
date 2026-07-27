## Context

`apps/api/src/instance-config/prompt-loader.ts` renders prompt files through a bespoke grammar: a regex matches `${...}`, `assertSupportedPromptExpressions` rejects anything outside `${model.id}` / `${model.name}` / `$${model.name}`, and `renderPrompt` substitutes at boot. The design is deliberately minimal and has two properties worth keeping: **fail-loud at deploy time** (an unrecognized expression aborts startup, so a typo cannot ship) and **single-pass, non-recursive** rendering before the result is hashed and snapshotted.

It cannot express absence. Substituting a value that may be unset leaves its label, heading, or enclosing sentence behind. Three designs were attempted to avoid conditionals and all three failed on concrete examples: an llame-owned composite block (solves residue, but the operator cannot reshape it — the opposite of what a config-as-code surface should offer), a "drop the line when its expressions all render empty" rule (deletes operator-authored instructions that share the line, and breaks multi-line structure), and absence markers (put llame's prose inside the operator's sentences, and are only defensible if applied everywhere, at which point per-field expressions stop being "value or nothing"). Per-user context, which needs exactly this, is the next change; project instructions and later memory surfaces need it too.

Nothing is in production, so a breaking syntax change is affordable now and will not be later.

## Goals / Non-Goals

**Goals:**

- Give operators conditionals, so absent values take their scaffolding with them.
- Preserve fail-loud deploy-time validation, single-pass non-recursive rendering, and the fragment-free prompt model.
- Establish the security boundary for templated prompts before any per-user data flows through it.
- Keep prose readable — escaping must not mangle natural language.

**Non-Goals:**

- Exposing any new value. The renderable set stays `model.id` and `model.name`.
- Per-user context of any kind — that is `add-user-personalization`, which owns the opt-out gate.
- A dual-syntax migration path or deprecation window.
- Loops, custom helpers, partials, or arbitrary expression evaluation.

## Decisions

### D1: Handlebars rather than a bespoke conditional

Extending `${...}` with conditional syntax means designing block delimiters, nesting rules, and an evaluator — reinventing a solved problem, in the security-sensitive path that assembles system prompts. Handlebars is mature, widely known by operators, logic-less by default, and ships escaping and conditionals. Alternatives considered: Mustache (no `unless`, weaker tooling), Liquid (larger surface, filters and tags we would have to disable), EJS or template literals (arbitrary JavaScript execution — categorically wrong here).

### D2: Strict at boot, lenient at render

Handlebars' default behavior is the inverse of what llame needs: unknown variables render as empty string silently, so `{{user.personalizaton.about}}` would render nothing forever. `strict: true` throws instead — but at _render_ time, per run, which would let a missing value fail a user's request.

So the two are separated. At boot, `Handlebars.parse()` yields an AST that is walked and validated; anything outside the allowlist fails startup naming the model id and the construct. At render, the compiled template runs non-strict, so an allowlisted-but-absent value renders empty and no run can fail on missing data. Deploy-time typos are impossible and request-time absence is harmless — strictly better than either mode alone.

### D3: The AST allowlist has four rejections, not one

Identifier allowlisting is the obvious one. The other three are each load-bearing:

**Unescaped output** (`{{{ ... }}}`) would let an operator bypass escaping and, once per-user values exist, let owner-authored text forge the fence that delimits it.

**Partials** (`{{> ... }}`) are prompt fragments and inheritance, which `model-system-prompts` explicitly forbids. Handlebars ships them by default, so adopting the engine without rejecting them would silently hand operators a file-include mechanism in the one place the spec says none exists. This is the rejection most easily missed.

**Helpers other than `if`/`unless`** keep the evaluable surface closed. No helper is registered, and `each` is excluded too — no renderable value is a collection, and admitting loops now would invite a data shape the context projection does not have.

### D4: Context is a hand-built projection, never a record

With a closed token list the security boundary was the token list itself. With a template engine it becomes the **shape of the context object**, and that is the substantive risk in this change. `users` carries a `password` column, so passing a user row as context would make `{{user.password}}` render a credential hash into a system prompt, into an immutable `model_context_snapshots` row with no purge path, and into the owner-visible context receipt. The same hazard applies to any config object (provider keys) or ORM entity (lazy relations).

So the context is constructed field by field from explicitly chosen values, and that is a spec requirement with a test rather than a convention. Pinning a Handlebars version whose prototype-property access is disabled by default closes the adjacent path where `{{__proto__.…}}` reaches beyond the projection.

### D5: Custom escaping — protect the fence, keep the prose

Handlebars escapes for HTML by default, turning `don't` into `don&#x27;t` and `"quoted"` into `&quot;quoted&quot;`. In a natural-language system prompt that is visible damage on every request carrying prose, and it will be worse once free-text personalization flows through it. Raw output is not the answer either: it reopens delimiter forging.

Escaping is therefore narrowed to the characters that could forge a structural delimiter, leaving apostrophes, quotation marks, and ordinary punctuation untouched. Implementation note: this requires an isolated Handlebars environment with its escape function replaced, rather than the global default — confidence moderate on the exact API surface, so it needs verification during implementation, and the fallback is pre-escaping projected values with raw output confined to the loader (never reachable from a template).

### D6: Hard cutover

Supporting both syntaxes means two parsers, ambiguous precedence where a file contains both, and a deprecation window to police. With no production deployments the cost of migrating is one packaged prompt file plus any operator's own file, and a stale `${...}` fails startup with a named error rather than rendering literally into a prompt — so nobody silently ships a broken prompt.

## Risks / Trade-offs

- **Context object becomes the security boundary and a future contributor extends it carelessly** → D4 makes the projection a spec requirement with a test asserting no record is reachable; the `password` column is the concrete case named in the spec so the reason is not lost.
- **Escaping customization is wrong and either mangles prose or fails to neutralize delimiters** → dedicated test asserting apostrophes survive and delimiters do not; fallback path recorded in D5.
- **Handlebars prototype-pollution CVE history** → pin a version with prototype access disabled by default; no helpers registered; AST validation rejects everything outside the subset.
- **Operators must migrate a shipped config surface** → accepted; fails loud with a named error, no production deployments, one-line docs migration.
- **A template engine is heavier than three tokens** → true today, and the amortization is explicit: per-user context, account identity, and project instructions each need conditionals, and each would otherwise extend a bespoke grammar again.
- **`if` truthiness on an empty string is engine-defined rather than ours** → an empty string is falsy in Handlebars, which is the behavior operators want for "omit the label when unset"; asserted by test so an engine upgrade cannot change it silently.

## Migration Plan

1. Add the pinned `handlebars` dependency to `apps/api`.
2. Replace `assertSupportedPromptExpressions` and `renderPrompt` with parse, AST validation, and compile-and-render, keeping the existing error type and message shape so failures stay recognizable.
3. Migrate `apps/api/src/prompts/chat-default.md` (`${model.id}` → `{{model.id}}`).
4. Add the stale-`${...}` rejection so a partially migrated deployment fails loudly.
5. Document the subset, the four rejections, and the migration in `apps/api/AGENTS.md`.

Rollback: revert the loader and the packaged prompt together. No schema, no persisted data, and no API surface changes, so rollback is a code revert with no migration.

## Open Questions

- Exact API for replacing the escape function on an isolated Handlebars environment (D5) — verify during implementation; the fallback is projection-time escaping with raw output confined to loader code.
- Whether to also reject `{{else}}` — it is part of `if`/`unless` rather than a separate helper, so it is expected to be allowed; confirm the AST represents it as such rather than as an independent node.
