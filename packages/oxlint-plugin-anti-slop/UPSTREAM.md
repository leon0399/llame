# Upstream provenance

The base of this directory is vendored from
[`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop) commit
`c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (upstream `main`, 9 commits past the
`v0.1.2` tag, which predates the last four rule changes).

- Source path: `skills/install-anti-slop/assets/anti-slop/`
- License: MIT; retained in [`LICENSE`](LICENSE)
- `package.json` marks the vendored TypeScript boundary as ESM for Node's plugin
  loader; `tsconfig.json` applies upstream's strict compiler settings to the
  installed asset and its local regression.
- Previous base: `446268e5d15baa968eaec669ff65358d36ae6259`, reconciled on
  2026-09-12 with upstream's own `skills/install-anti-slop/references/update.md`
  three-way procedure (base was recoverable from the pinned asset, so every
  incoming change is classified rather than ported blind). That merge added
  `no-array-filter-map`, `no-reduce-accumulator-copy`,
  `shared/array-method.ts`, `shared/type-alias-resolution.ts`,
  `shared/scope.ts`, and `shared/function-parameters.ts`, rebuilt
  `shared/dictionary-types.ts` on per-use alias resolution, and adopted
  upstream's tests for every rule whose semantics changed.

## Deliberately not adopted from the current revision

- `require-readable-spacing` and its vendored
  `vendor/eslint-stylistic/padding-line-between-statements.ts`. It is an
  autofixable blank-line policy, llame's formatter is `prettier` and has no
  blank-line policy, and applying it measured **11,315 insertions across 757
  files** (362 of them non-test source) — a repository-wide formatting
  migration, not a lint-rule upgrade. Upstream's own install guidance keeps
  whitespace fixes out of semantic edits and warns against enabling a competing
  formatting preset. Adopt it, if ever, as its own isolated autofix commit with
  a repository-wide diff and no other change in it.
- The `effect/` plugin and its five rules. llame has no `effect` dependency and
  no `effect` import, and the upstream skill says to register that group only
  for repositories that depend on Effect directly.

Upstream's native companion for `no-reduce-accumulator-copy`,
`oxc/no-accumulating-spread`, **is** enabled in the root `.oxlintrc.json`. It
found a quadratic accumulator in `apps/api/src/knowledge/knowledge-tools.ts`,
now a single-pass push/pop.

## Local patches retained

- Local correctness patch: `no-chained-type-assertions` treats
  `TSNonNullExpression` as a transparent wrapper. Without it,
  `(value as unknown)! as Target` bypasses the rule. Re-verified against the
  current revision: upstream still does not report
  `(maybe as unknown)! as Target`, so the patch remains a divergence. The
  standard Oxlint `RuleTester` regression lives beside the rule, extended with
  upstream's own cases so a re-pull cannot change either set silently.
- Local correctness patch: `no-unknown-parameters` exempts a type predicate's
  own subject parameter (`function isFoo(value: unknown): value is Foo`).
  TypeScript requires that parameter to be typed `unknown` for the guard to
  be sound — no narrower type satisfies it — so this is the canonical
  legitimate use the rule exists to funnel code toward, mirrored by
  upstream's own `cause` carve-out for the same reason. Only the parameter
  the predicate names is exempted; a second `unknown` parameter in the same
  signature, or a predicate on a different parameter, is still flagged. The
  current upstream revision converged on the same exemption
  (`isTypePredicateSubject`); llame's form is kept because it shares the
  predicate-naming helper with the option below, and upstream's test cases for
  it are merged into llame's suite. The standard Oxlint `RuleTester`
  regression lives beside the rule.
- Local correctness patch: `no-unknown-parameters` gains an options schema,
  mirroring `no-runtime-typeof`'s `allowInTypeGuards` shape (both booleans,
  default `false`, opt-in per Oxlint config). Upstream's own exemption
  mechanism for this rule is a hardcoded parameter name (`cause`), so a
  configurable exemption is consistent with its design, not a departure from
  it. Upstream carries neither option at the current revision, so adopting its
  body wholesale would drop them.
  - `allowWhenImmediatelyValidated`: exempts a parameter whose first use in
    the function body validates that same parameter -- a type-guard call
    (`isFoo(value)`, `Array.isArray(value)`), a `typeof`/`instanceof`
    narrowing check (including the switch-statement spellings
    `switch (typeof value)` and a trivial `switch (true) { case <test>: ... }`
    whose first case tests the parameter), a schema parse
    (`Schema.parse(value)` / `.safeParse(value)`), optionally wrapped in a
    negation -- or, for a body-less overload signature (which has no body of
    its own to inspect), the verdict of the adjacent implementation
    signature with the same function name. `Array.isArray` and `switch`
    widenings are universally correct TypeScript/JS semantics (TypeScript's
    own `lib.es5.d.ts` declares `Array.isArray` a type guard; a `switch` is
    the same check as its `if`/`===` spelling), not codebase-specific
    heuristics; the overload-signature widening is a mechanical artifact of
    the declaration form (an overload's `TSDeclareFunction` node has no body
    by construction), not a statement about the parameter's safety. The
    rule's own message instructs callers to "run the expected schema or
    parser at the I/O boundary before calling this function"; when the
    function itself immediately does exactly that, it satisfies the rule's
    intent rather than violating it. Deliberately conservative: an
    undetermined first use (no body, empty body, an unrecognized
    first-statement shape, or an unresolvable overload implementation) is
    never exempted, so false negatives (still flagged, needing a per-site
    disable) are expected and acceptable, but a false positive (silently
    exempting genuinely unvalidated input) is not.
  - `allowErrorFamilyNames`: extends the rule's own `cause` carve-out to the
    rest of the error family -- `error`, `err`, `reason` -- covering
    error-classification helpers and catch bindings that inspect an unknown
    thrown value without ever wrapping it into an actual `cause`. Kept as a
    small fixed name set gated by one boolean, not an arbitrary configurable
    allowlist array -- an array invites incrementally adding generic names
    (`value`, `input`, `data`) over time, which would rubber-stamp the rule's
    own target population instead of extending a specific, narrow, load-
    bearing exemption.
  - The standard Oxlint `RuleTester` regression lives beside the rule,
    covering both options' exempted and still-flagged (negative) cases, and now
    upstream's cases for the same rule.
- Local correctness patch: `no-known-value-widening` only follows a binding's
  initializer for known-evidence when the binding is a plain identifier. The
  upstream call-argument check resolves an argument to its declarator, and for
  `const { data } = value as { data: unknown }` that read the cast's container
  shape as evidence about `data`, which is `unknown`. Seven boundary validators
  in `apps/web/lib/services/chat/history.ts` were misreported before the
  guard. Cost of the guard: a false negative for
  `const { data } = value as { data: string }`. The rule's stated stance -- a
  false positive on unvalidated input is the worse failure -- decides it. The
  standard Oxlint `RuleTester` regression lives beside the rule, extended with
  upstream's cases.
- Local policy patch: `no-module-mocking` reports only first-party specifiers;
  external npm packages stay mockable. Upstream never changed this rule's
  logic, so the patch is llame's alone: without it the rule reports 32 sites in
  this repository instead of 1.
- Style-only divergence, applied to every vendored rule and helper:
  `Array<T>`/`ReadonlyArray<T>` rather than `T[]`/`readonly T[]`, because
  `typescript/array-type` is set to `generic` in the root `.oxlintrc.json`.
  Formatting is `prettier`. Neither changes behavior.
- `shared/scope.ts` and `shared/function-parameters.ts` are adopted under
  upstream's own file names, replacing llame's `resolve-variable.ts` and
  `function-like.ts`, so the next re-pull matches file for file.
  `FunctionLikeNode` is kept as a documented local export in
  `function-parameters.ts`; upstream repeats that union inline in four rules,
  which lets the four drift apart.
- `shared/dictionary-types.ts` keeps llame's deletion of
  `isPopulatedObjectExpression`: upstream still exports it, but nothing in
  upstream or here imports it.
- Local correctness patch: `shared/array-method.ts` recognizes `flat` and
  `with` as array-returning methods in `isKnownArrayExpression`, so
  `values.flat().filter(...).map(...)` and `values.with(...).filter(...)` are
  reported. Upstream omits both, although it lists `with` among the accumulator
  copy methods in `no-reduce-accumulator-copy`, so the omission is an
  oversight rather than a boundary. `RuleTester` cases for both pipelines live
  beside `no-array-filter-map`.
- Local correctness patch: `shared/type-alias-resolution.ts` records
  `TSImportEqualsDeclaration` as a type binding, so `import Record =
Models.Record` shadows the built-in for `hasVisibleTypeBinding` exactly as
  the three import forms upstream already handles do. Without it,
  `no-unsafe-dictionary-type` reads a local `Record<string, unknown>` as the
  built-in. The valid regression case sits with the existing import-shadowing
  case in `no-unsafe-dictionary-type.test.ts`. Both patches were raised in
  review of this reconciliation; neither construct appears in llame's own
  source today, so they are insurance for the vendored rule, not fixes for a
  live false positive.
- `no-runtime-typeof.test.ts` adds loose-equality existence probes
  (`typeof x == "undefined"`, `!=`) to its valid set. The rule exempts all four
  equality operators; upstream's tests covered only the strict pair, so one of
  the two exemptions could have been removed without failing.
- Per-site exceptions live at the call site, not in the rule:
  `oxlint-disable-next-line anti-slop/no-known-value-widening` with a reason at
  the four guards that re-validate a server-authored value the type cannot
  fully express (`knowledge-tools.ts` union discriminant; the context-item,
  model-change, and temporal authoring guards in `apps/api/src/chats/`).
- `packages/oxlint-plugin-anti-slop/.oxlintrc.json` turns
  `anti-slop/no-unknown-parameters` off for `rules/**` and `shared/**`:
  upstream's own `configuredSafetyMarkers(option: unknown)` is the rule's
  target shape, and repository style does not apply to vendored rule source.

## Verification of the current base

`pnpm lint:code` (all workspaces), `pnpm --filter api typecheck`, the plugin's
`registry.check.mjs`, and its 16 `RuleTester` files all pass. Behavior parity was
checked by running the installed plugin against the pinned revision on the same
fixtures: the existence probe, the borrowed member name, and the type-parameter
constraint stopped reporting; the union alias, the generic alias return, and the
known argument to a local `unknown` predicate started reporting; the
non-null-wrapper assertion chain still reports here and not upstream.

Update by reviewing the upstream diff, running its `install.mjs` into a temporary
directory, and reconciling every local patch above before replacement. Remove a
local patch when upstream carries equivalent coverage. Keep llame-specific
enablement and exceptions in Oxlint configuration, not in the vendored rule
source.

## Second upstream: stella/stella `.oxlint-plugins`

`vendor/` holds rules vendored from
[`stella/stella`](https://github.com/stella/stella/tree/main/.oxlint-plugins),
fetched 2026-08-31. Which rules were taken, which were rejected, and the
evidence for each, are recorded in
[`docs/research/lint/2026-08-31-stella-oxlint-plugins.md`](../../docs/research/lint/2026-08-31-stella-oxlint-plugins.md).

| File                                   | Enforces                                                       |
| -------------------------------------- | -------------------------------------------------------------- |
| `stella-utils.ts`                      | Shared AST helpers every vendored rule imports (verbatim)      |
| `require-timestamptz-column.ts`        | Drizzle timestamp columns go through `src/db/columns.ts`       |
| `forbid-process-env-outside-env-ts.ts` | Settings come from `llame.config.json`, not bare `process.env` |
| `no-unsafe-inner-html.ts`              | Raw-HTML sinks carry a `safe-html:` provenance comment         |

**Two edits per rule, and no others.** Upstream exports a one-rule plugin per
file (`eslintCompatPlugin`); llame registers every rule through a single
`index.ts`, so the wrapper becomes an exported `defineRule`. And the shared
helper import is repointed from `./utils.ts` to `./stella-utils.ts`. Detection
logic, options, messages, and documented boundaries are upstream's.

**`vendor/` is a typecheck and lint boundary, deliberately.** Each file opens
with `@ts-nocheck` and the directory is excluded from llame's own anti-slop
rules in `.oxlintrc.json`. Upstream compiles under a looser configuration than
llame's `strict`, and enforcing llame's opinions here would mean rewriting the
code — which is what vendoring exists to avoid. Adapting a vendored rule to
llame's style is how you lose the ability to re-pull it.

What still guards these files: `registry.check.mjs` imports the built plugin and
asserts the rules it exposes match the two rule directories, so a vendored file
that fails to parse, fails to resolve an import, or silently stops being
registered fails the check with a stack trace.

**That guard exists because its absence bit.** A duplicate import in `index.ts`
made oxlint fail plugin loading outright — which it reports as a configuration
warning and then lints on without any anti-slop rule. Every workspace read
"0 violations" while all 21 then-registered rules were off.
`--report-unused-disable-directives` cannot catch this, and neither could the
previous registry check, which compared file names to map keys without ever
loading the module.

**Local adaptation, not a patch to upstream logic:** llame has no `env.ts`, so
`forbid-process-env-outside-env-ts` is configured through its own `allowedFiles`
option in `.oxlintrc.json` rather than upstream's default patterns.
`require-timestamptz-column`'s message names `@/api/db/columns`, which is
stella's path alias; llame's helper is at `apps/api/src/db/columns.ts` and is
imported relatively. The message is upstream's text, left unedited.
