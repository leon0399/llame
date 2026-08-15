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

### D3: Allowlist node kinds — a blocklist is provably insufficient

The validator permits exactly four node kinds — literal content, value expressions, block expressions, and comments — and rejects everything else. This is deny-by-default rather than four named rejections, and probing 4.7.9 showed why that matters: a partial invoked with a fallback block (`{{#> layout}}…{{/layout}}`) parses as `PartialBlockStatement`, a **different node kind** from the `PartialStatement` produced by `{{> x}}`, and an inline partial defined through a decorator (`{{#*inline "x"}}…{{/inline}}`) parses as `DecoratorBlock` and **renders successfully**. A blocklist naming "partials" would have missed two of the three forms. An allowlist also rejects any node kind a future engine version introduces without a code change.

Within the permitted kinds, three constraints do the remaining work, each keyed to a verified AST fact:

**Helper invocation is a property, not a kind.** `{{a.b}}` and `{{fmt a}}` are both `MustacheStatement`; what distinguishes them is `params.length`. So a value expression is required to reference an allowlisted path and carry no parameters — which also rejects subexpressions, since `{{helper (other a)}}` is a parameterized `MustacheStatement`.

**Block expressions are restricted by path.** `{{#if a}}` and `{{#myHelper a}}` are both `BlockStatement`, distinguished by `path.original`, so only `if` and `unless` are permitted. This deliberately also rejects inverse-section shorthand (`{{^cond}}`), whose path is the _data_ path rather than a helper name — allowing it would mean the path position sometimes names a helper and sometimes names data, which is exactly the ambiguity the allowlist exists to avoid. Operators write `{{#unless cond}}`.

**Unescaped output is a property too**: a triple-stache is a `MustacheStatement` with `escaped === false`, not a distinct kind.

Comments are permitted — they carry no data, never reach output, and let operators annotate a prompt they now own the structure of.

### D4: Context is a hand-built projection, never a record

With a closed token list the security boundary was the token list itself. With a template engine it becomes the **shape of the context object**, and that is the substantive risk in this change. `users` carries a `password` column, so passing a user row as context would make `{{user.password}}` render a credential hash into a system prompt, into an immutable `model_context_snapshots` row with no purge path, and into the owner-visible context receipt. The same hazard applies to any config object (provider keys) or ORM entity (lazy relations).

So the context is constructed field by field from explicitly chosen values, and that is a spec requirement with a test rather than a convention. Pinning a Handlebars version whose prototype-property access is disabled by default closes the adjacent path where `{{__proto__.…}}` reaches beyond the projection.

### D5: Escape exactly `& < >` via `SafeString`, and scope the promise honestly

Verified against handlebars 4.7.9. Default escaping is more aggressive than HTML-safety framing suggests:

```text
input   don't <tag> "q" & x = y ` z
default don&#x27;t &lt;tag&gt; &quot;q&quot; &amp; x &#x3D; y &#x60; z
```

Apostrophes, quotation marks, `=`, and backticks all become character references — prose is mangled and a code or shell fragment in a user's text is destroyed. Unacceptable on every request.

An earlier draft proposed replacing the escape function on an isolated environment. **That does not work**: `Handlebars.create()` returns a distinct environment but **shares `Utils` by reference** with the global (`env.Utils === Handlebars.Utils` is `true`), so patching it monkey-patches handlebars process-wide — verified by observing the global compile emit the patched output. Rejected as a landmine for any other consumer in the process.

The working approach is idiomatic: the **context projection applies llame's own escaping and wraps each value in `Handlebars.SafeString`**. Templates use ordinary `{{ }}`, the validator still rejects unescaped output, and the engine emits the pre-escaped string verbatim with no second pass. Verified: `</fence>` in a value renders as `&lt;/fence&gt;` and cannot close surrounding markup, prose survives, and the global escape function is untouched.

**The escaped set is fixed and named: `&`, `<`, `>`.** Nothing else — escaping exists to keep a rendered value from introducing markup, not to make any guarantee about operator-authored delimiters, which llame cannot know the shape of.

**Line breaks in values are deliberately left alone.** An earlier draft stripped them from single-line values, on the theory that `\n\nSYSTEM: …` escapes a line-oriented label. It was cut with the rest of the operator-as-attacker framing: `model.id` and `model.name` come from `llame.config.json`, which the same operator authors alongside the prompt file, so there is no boundary being crossed.

**Consequence that must not be missed: a `SafeString` is an object, so it is always truthy — even wrapping an empty string.** `{{#if v}}` with `v = new SafeString("")` evaluates **true**. Absent and empty values must therefore be **omitted from the context entirely** rather than wrapped as empty, or every conditional silently stops working. A plain `" "` is also truthy, so values are trimmed and treated as absent when empty after trimming. Both asserted by test.

### D5a: Whitespace control is available but unnecessary — and harmful if misapplied

Handlebars' standalone-tag handling already removes lines containing only a block tag, so the readable multi-line form needs no tilde. Verified with `A\n{{#if x}}\n## Heading\n\n{{x}}\n{{/if}}\nB`:

```text
x set     "A\n## Heading\n\nVAL\nB"
x absent  "A\nB"
```

Zero residue in both cases. Adding `~` to the same template produces `"A## Heading\n\nVALB"` — the tilde strips the newline before the opening tag and after the closing tag, gluing adjacent content together. So `{{~#if}}` is the wrong tool here despite looking purpose-built for it; the default is already correct.

Whitespace control is nonetheless **permitted**: it is represented in the AST as `openStrip`/`closeStrip` properties on a node rather than as a distinct node type or helper, so it passes the allowlist validation with no special handling and operators can use it where they genuinely want it.

### D6: Hard cutover

Supporting both syntaxes means two parsers, ambiguous precedence where a file contains both, and a deprecation window to police. With no production deployments the cost of migrating is one packaged prompt file plus any operator's own file, so no compatibility shim is carried: `${...}` is simply not template syntax any more.

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
4. Document the subset, the four rejections, and the migration in `apps/api/AGENTS.md`.

Rollback: revert the loader and the packaged prompt together. No schema, no persisted data, and no API surface changes, so rollback is a code revert with no migration.

## Open Questions

Both prior open questions were resolved empirically against handlebars 4.7.9 and are recorded in the decisions above: the escape-function approach (D5 — patching is not isolable; `SafeString` is the answer) and the representation of `{{else}}` (it is the `inverse` of its `BlockStatement`, not an independent node, so the helper allowlist needs no special case for it).

Implementation facts the validator depends on, verified rather than assumed:

- Unescaped output is a `MustacheStatement` with `escaped === false`, **not** a distinct node type — detect it on the property.
- A helper invocation is also a `MustacheStatement`; what distinguishes `{{foo bar}}` from a bare `{{foo}}` is a non-empty `params` (or `hash`), not the node type.
- A partial is a distinct `PartialStatement`, so rejecting it is a type check.
- Prototype property access is already denied by default in 4.7.9 (it logs a warning and renders empty), which is the behavior the version pin is protecting.
