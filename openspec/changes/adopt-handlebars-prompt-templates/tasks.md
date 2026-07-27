## 1. Dependency and environment

- [ ] 1.1 Add `handlebars` to `apps/api` pinned to a version whose prototype-property access is disabled by default, and record why the floor exists in the dependency comment or `AGENTS.md`
- [ ] 1.2 Use a created Handlebars environment for prompt rendering with no registered helpers or partials — and do NOT mutate `Utils.escapeExpression` on it: verified that `Handlebars.create()` shares `Utils` by reference with the global, so patching it changes escaping process-wide
- [ ] 1.3 Pin with tests the truthiness facts this design depends on: `""` is falsy, `" "` is truthy, an absent path is falsy, and an already-safe wrapper is truthy **even when empty** — which is why empty values must be omitted from the context rather than wrapped

## 2. Boot-time AST validation

- [ ] 2.1 Replace `assertSupportedPromptExpressions` in `apps/api/src/instance-config/prompt-loader.ts` with a parse-and-walk validator over `Handlebars.parse()`, preserving the existing `InstanceConfigError` type and message shape (model id plus offending construct, never prompt contents)
- [ ] 2.2 Reject identifiers outside the allowlist, exposing the allowlist as an exported constant so `add-user-personalization` extends one list rather than editing the walker
- [ ] 2.3 Reject unescaped output (triple-stache) nodes
- [ ] 2.4 Reject partial references, with a code comment naming the `model-system-prompts` no-fragments/no-inheritance requirement so the reason survives refactoring
- [ ] 2.5 Reject every helper other than built-in `if` and `unless`; confirm `else` is represented as part of those blocks and not as an independent node, and reject `each`
- [ ] 2.6 Reject a stale `${...}` expression anywhere in a template, so a partially migrated deployment fails loudly instead of emitting it literally
- [ ] 2.7 Assert emptiness is still evaluated such that a template whose only content is expressions and whitespace fails startup as empty

## 3. Rendering

- [ ] 3.1 Compile and render non-strict, so an allowlisted context path with no value renders empty and never raises at request time
- [ ] 3.2 Build the render context as an explicit hand-constructed projection (`model.id`, `model.name` only); add a test asserting no database row, ORM entity, or config object is reachable through any context path, naming `users.password` as the case that must stay unreachable
- [ ] 3.3 Apply narrow escaping (`<`, `>`, `&`) when building the context and mark values already-safe so the engine emits them unchanged; test that apostrophes, quotation marks, `=`, and backticks survive verbatim, that a value containing a closing delimiter cannot terminate surrounding markup, and that the global escaping behavior is unchanged afterwards
- [ ] 3.4 Assert rendering is single-pass: a rendered value containing template-looking text appears literally and is not re-parsed
- [ ] 3.5 Keep boot-time validation operating on the template rather than on rendered output

## 4. Migrate the packaged prompt

- [ ] 4.1 Migrate `apps/api/src/prompts/chat-default.md` from `${model.id}` to `{{model.id}}`
- [ ] 4.2 Update the packaged-default validation test, and assert the rendered default is byte-identical to the pre-migration output for a model supplying both id and name

## 5. Coverage

- [ ] 5.1 Extend `prompt-loader.spec.ts` with one failing case per rejection: unknown identifier, triple-stache, partial, disallowed helper, stale `${...}`
- [ ] 5.2 Add passing cases: `if`/`unless` conditional omitting a label with its value, a multi-line block leaving no residue via standalone-tag handling, whitespace-control syntax accepted by the validator, literal-expression escaping, and lenient render of an allowlisted-but-absent value
- [ ] 5.3 Assert an absent `model.name` still fails startup, matching pre-cutover behavior

## 6. Verification and documentation

- [ ] 6.1 Run `pnpm --filter api lint`, `typecheck`, and `test`, and fix all findings
- [ ] 6.2 Document in `apps/api/AGENTS.md`: the allowed Handlebars subset, the four rejection rules and why partials are among them, the context-projection requirement, the custom escaping rationale, and the breaking migration for operators with a custom `systemPromptFile`
- [ ] 6.3 Add the dated `CHANGELOG.md` entry marking the breaking prompt-syntax change
