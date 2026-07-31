## 1. Dependency and environment

- [x] 1.1 Add `handlebars` as a direct `apps/api` dependency pinned exactly (`4.7.9`), whose prototype-property access is denied by default. NOT via the workspace `catalog:` — that is documented for dependencies used by 2+ workspaces, and this one is api-only
- [x] 1.2 Use a created Handlebars environment for prompt rendering with no registered helpers or partials — and do NOT mutate `Utils.escapeExpression` on it: verified that `Handlebars.create()` shares `Utils` by reference with the global, so patching it changes escaping process-wide
- [x] 1.3 Pin with tests the truthiness facts this design depends on: `""` is falsy, `" "` is truthy, an absent path is falsy, and an already-safe wrapper is truthy **even when empty** — which is why empty values must be omitted from the context rather than wrapped

## 2. Boot-time AST validation

- [x] 2.1 Replace `assertSupportedPromptExpressions` in `apps/api/src/instance-config/prompt-loader.ts` with a parse-and-walk validator over `Handlebars.parse()`, preserving the existing `InstanceConfigError` type and message shape (model id plus offending construct, never prompt contents)
- [x] 2.2 Implement the walker as an **allowlist of node kinds** (literal content, value expression, block expression, comment) rejecting every other kind by default, and expose the allowlisted context paths as an exported constant so `add-user-personalization` extends one list rather than editing the walker
- [x] 2.3 Reject unescaped output, detected as `escaped === false` on a value expression rather than as a distinct node kind
- [x] 2.4 Assert a partial is rejected, with a code comment naming the `model-system-prompts` no-composition requirement; the allowlist covers its other syntactic forms for free
- [x] 2.5 Reject helper invocation in both positions: a value expression carrying parameters (which also covers subexpressions), and a block expression whose path is not `if`/`unless` (which also covers `each`); `else` needs no special case, being the `inverse` of its own block
- [x] 2.6 Reject a stale `${...}` expression anywhere in a template, so a partially migrated deployment fails loudly instead of emitting it literally
- [x] 2.7 Assert emptiness is still evaluated such that a template whose only content is expressions and whitespace fails startup as empty

## 3. Rendering

- [x] 3.1 Compile and render non-strict, so an allowlisted context path with no value renders empty and never raises at request time
- [x] 3.2 Build the render context as an explicit hand-constructed projection (`model.id`, `model.name` only); add a test asserting no database row, ORM entity, or config object is reachable through any context path, naming `users.password` as the case that must stay unreachable
- [x] 3.3 Escape exactly `&`, `<`, `>` when building the context and mark values already-safe so the engine emits them unchanged; test that apostrophes, quotation marks, `=`, and backticks survive verbatim, that a closing XML-style delimiter in a value cannot terminate surrounding markup, and that the global escaping behavior is unchanged afterwards
- [x] 3.4 Assert rendering is single-pass: a rendered value containing template-looking text appears literally and is not re-parsed
- [x] 3.5 Keep boot-time validation operating on the template rather than on rendered output

## 4. Migrate the packaged prompt

- [x] 4.1 Migrate `apps/api/src/prompts/chat-default.md` from `${model.id}` to `{{model.id}}`
- [x] 4.2 Update the packaged-default validation test, and assert the rendered default is byte-identical to the pre-migration output for a model supplying both id and name

## 5. Coverage

- [x] 5.1 Extend `prompt-loader.spec.ts` with a failing case per rejection: unknown identifier, unescaped output, a partial, a parameterized value expression, a non-`if`/`unless` block, and a stale legacy expression
- [x] 5.2 Add passing cases: `if`/`unless` conditional omitting a label with its value, a multi-line block leaving no residue via standalone-tag handling, whitespace-control syntax accepted by the validator, literal-expression escaping, and lenient render of an allowlisted-but-absent value
- [x] 5.3 Assert an absent `model.name` renders empty instead of failing startup, and that a conditional over it evaluates false — the pre-cutover fail-on-reference rule is deliberately dropped because it would reject the conditional idiom

## 6. Verification and documentation

- [x] 6.1 Run `pnpm --filter api lint`, `typecheck`, and `test`, and fix all findings
- [x] 6.2 Document in `apps/api/AGENTS.md`: the allowed Handlebars subset and that validation is deny-by-default, why fragments are rejected in all forms, the context-projection requirement, the escaped character set, and the breaking migration for operators with a custom `systemPromptFile`
- [x] 6.3 Add the dated `CHANGELOG.md` entry marking the breaking prompt-syntax change
