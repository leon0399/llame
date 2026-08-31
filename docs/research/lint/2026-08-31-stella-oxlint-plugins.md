# What to adopt from stella's oxlint plugins

Noncanonical. Evidence and options for extending llame's lint surface, from a
read of [`stella/stella/.oxlint-plugins`](https://github.com/stella/stella/tree/main/.oxlint-plugins)
(133 rule modules) on 2026-08-31, alongside
[`nkzw-tech/oxlint-config`](https://github.com/nkzw-tech/oxlint-config).

## The headline

Most of stella's 133 rules are domain-specific to it (matter glyphs, public case
law, playbook verdicts, Eden, Convex) and are not portable. **The portable value
is not the rule list — it is that stella enforces in a linter what llame states
in prose.**

llame's `AGENTS.md` §Security declares four invariants and enforces none of them
mechanically:

| llame declares (prose only)                                                                                                                   | stella enforces (rule)                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| "Authorization identity comes only from a trusted, authenticated source — never from client-controlled input (params, body, query, headers)." | `no-body-ownership-ids`                                                          |
| "Secrets stay secret — never commit, log, print, or echo credentials, keys, or tokens."                                                       | `no-secret-in-log-sink`, `no-raw-error-logging`, `no-redacted-log-attribute-key` |
| "Bare env vars are NOT a config source — the environment reaches settings only via `{env:…}` tokens." (`apps/api/AGENTS.md`)                  | `forbid-process-env-outside-env-ts`                                              |
| "Parse untrusted input at its boundary before narrowing it." (anti-slop messages)                                                             | `no-unvalidated-json-domain-cast`                                                |

A prose invariant is enforced by whoever happens to review the PR. That is the
gap worth closing, and it is worth more than any size rule.

## Tier 1 — adopt: enforces an invariant llame already declares

1. **`no-body-ownership-ids`** — rejects a request body or query string supplying
   a trusted ownership id. This is llame's single most important security rule
   and it is currently review-only. Highest value on this list.
2. **`no-secret-in-log-sink`** + **`no-raw-error-logging`** — traces
   secret-named values into logging, analytics, error, and serialization sinks.
   llame resolves `{env:…}`/`{path:…}` tokens and holds MCP session ids and
   provider keys; the rule that they never reach a sink is asserted in three
   documents and checked by nobody.
3. **`no-vacuous-throw-assertion`** — `toThrow()` with no argument is satisfied
   by _every_ error, so it keeps passing once the code fails for an unrelated
   reason. This is `docs/testing.md` rule 11's exact shape, mechanically
   detectable, and a direct extension of the tautological-test sweep. Cheapest
   real win here.
4. **`forbid-process-env-outside-env-ts`** — confines unvalidated `process.env`
   reads to declared boundaries. Near-exact match for llame's config-as-code
   rule, which today is a convention a new module can silently break.
5. **`suppression-hygiene`** (`require-description`, `no-foreign-directive`) —
   every disable must name a rule and explain itself, and directives for another
   engine are rejected. llame already runs `--report-unused-disable-directives`;
   this closes the other half. Note llame currently carries `eslint-disable`
   comments in `packages/config-interpolation` while running oxlint —
   `no-foreign-directive` would catch exactly that drift.
6. **`no-unvalidated-json-domain-cast`** — rejects asserting `response.json()` or
   `JSON.parse()` output straight into a closed domain type.

## Tier 2 — adopt if cheap: maps to an existing convention

- `require-query-key-factory` and `no-spread-input-in-query-key` — `apps/web`
  documents a key-factory convention that the tautological-test sweep already
  found unanchored in four services.
- `no-swallowed-rejection` — a `.catch()` returning a constant empty value is
  fail-open, which llame's security section forbids in prose.
- `require-fetch-timeout` — llame has a bounded MCP fetch; nothing stops the
  next network call from omitting the bound.
- `no-eager-singleton`, `no-db-await-in-loop`, `require-escape-like`,
  `no-unsafe-inner-html`, `ai-output-strict-schema`.

## Do not adopt

Anything naming a stella domain, its storage or router choices, or its design
system: `no-direct-matter-glyph`, `public-law-*`, `require-eden-error-check`,
`no-bare-chrome-query`, `no-physical-properties`, `stella-toast`, and the rest.
`no-crypto-random-uuid` and `no-nanoid` encode Bun-specific id choices llame does
not share.

## The practices are worth more than the rules

Four things stella does structurally, in rough order of value to llame:

1. **A suppression ratchet.** Per-rule budgets that only ever decrease, with
   security-tier suppressions additionally requiring a waiver entry. "A baseline
   reseed is not a mechanical way to make CI pass."

   This is directly relevant right now: llame has ~328 violations outstanding
   against newly-enforced rules. A ratchet is not a weakening — it enforces every
   rule immediately and prevents regression while the backlog burns down, which
   is strictly better than either a red build or a relaxed rule.

2. **Regression fixtures where the suppression IS the test.** Each rule has a
   fixture containing an intentionally suppressed violation. If the detector
   stops reporting, that directive becomes unused and CI fails. llame already
   runs `--report-unused-disable-directives`, so this works today at no cost —
   and it solves a real problem: `anti-slop`'s rule tests only run because
   `lint:anti-slop` globs them, and a rule whose detector silently breaks is
   invisible.

3. **A catalogue with honest scoping.** Every rule documents its detection
   boundary with flagged and accepted examples, and the README states plainly
   that "a rule can prove only the shapes described in its source. Security rules
   that recognize local data flow say so explicitly; they do not replace
   authorization, runtime validation, or integration tests." llame should copy
   that disclaimer verbatim in spirit — a lint rule named after a security
   property invites the belief that the property is proven.

4. **A registry check** keeping module names, exported rule ids, config,
   fixtures, and catalogue in sync, so a rule cannot be added to the plugin and
   forgotten in the config.

## What llame already has that these do not replace

`anti-slop/no-chained-type-assertions` and
`anti-slop/require-safety-comment-for-type-assertion` cover the same ground as
stella's `no-unjustified-double-assertion`; `anti-slop/no-module-mocking` covers
`no-internal-module-mock` — though stella's version is more workable, admitting
npm packages and runtime builtins as legitimate external boundaries while
rejecting only workspace-internal specifiers, and carrying a grandfathering
ledger with a ratchet.

That distinction is worth importing, but it is **not** an escape hatch for
llame's current backlog. Classifying all 79 `vi.mock` specifiers in `apps/web`:

| Kind                                                                                                            |  Count |
| --------------------------------------------------------------------------------------------------------------- | -----: |
| Internal (`./`, `../`, `@/`, `@workspace/`)                                                                     | **61** |
| External npm (`next/navigation` 12, `@ai-sdk/react` 3, `framer-motion`, `@tanstack/react-query`, `next/server`) | **18** |

So stella's boundary would excuse 18 and leave 61 — the mocks of
`lib/api/generated/*`, `lib/api/fetch`, `lib/services/*`, and `contexts/*` are
llame mocking its own modules, which is exactly what the rule exists to reject.
**Adopted.** `no-module-mocking` now reports only first-party specifiers —
relative paths, `@/`, `@workspace/`, `~/` — and permits bare npm packages. A
non-literal specifier fails closed. This is a correctness fix to the rule's
boundary, not a way to shrink the backlog: mocking `next/navigation` is
replacing an external interface, which the rule's own message already asks
for, and a Server Component's `redirect()` has no injectable seam behind it.
The first-party mocks it still reports need dependency injection or a move to
a Storybook play function.

## From nkzw-tech/oxlint-config — measured, then adopted

A first pass concluded that only nine of nkzw's remaining rules were free and
that the rest was style not worth its churn. **That measurement was wrong**: it
probed with `categories.correctness` set to `"off"`, which suppressed most of
what the rules would have caught and made the free set look ten times smaller
than it is. Re-measured against llame's real category settings, of nkzw's rules
that oxlint 1.78 recognises:

| Class                         | Count | Disposition                     |
| ----------------------------- | ----: | ------------------------------- |
| Adds zero violations to llame |   125 | **Adopted.** Pure ratchet.      |
| Adds violations, code fixed   |    18 | **Adopted**, code fixed to pass |

Twelve of nkzw's `react/*` rules do not exist in oxlint 1.78 and make it reject
the whole config if declared. `no-undef` is excluded for the reason nkzw itself
excludes it from `.ts`: it is meaningless under TypeScript.

The 125 free rules cost exactly one violation to enable — a genuinely empty
`catch` in the e2e readiness poll, which now carries the reason it is empty.

The 18 that cost violations were adopted by **fixing the code, not the rule**.
That was 317 files: `T[]` to `Array<T>` throughout, `catch (err)` to
`catch (error)`, `replace(/…/g)` to `replaceAll`, `String.raw` for
backslash-heavy literals, numeric separators, `Object.hasOwn`,
`import.meta.dirname`, merged `push` calls, and explicit `type` on two
`button`s. Two of them exposed real defects rather than style:
`prefer-object-has-own` failed to compile until an optional `env` was narrowed
instead of assumed, and `array-type` surfaced nested `Array<T>[]` shapes that
had been read as one-dimensional.

### The three that were briefly held back

A first attempt deferred `unicorn/prefer-at`, `unicorn/prefer-dom-node-append`,
and `no-warning-comments`. All three are now enforced. What the deferral got
wrong is worth keeping:

1. **`no-warning-comments` was never costly.** It was measured with the rule's
   DEFAULT terms (`todo`, `fixme`, `xxx`), which flags every TODO in the
   repository. nkzw configures it as `terms: ['@nocommit']`. With the options
   nkzw actually ships it adds **zero** violations, and it composes with
   `anti-slop/no-untracked-todo` rather than competing with it. **Measuring a
   rule without its configured options measures a different rule.**
2. **`unicorn/prefer-at`** cost 18 sites, and two were latent bugs rather than
   style. `nextKnowledgeSpaceCursor` guarded on `rows.length > page.length`,
   which does not imply `page` is non-empty — an empty page would read
   `undefined` and throw on `.createdAt`. `resolveDocumentBoundary` read
   `rows[0]` with no check at all. The `T | undefined` return of `a.at(-1)` is
   what surfaced both.
3. **`unicorn/prefer-dom-node-append`** cost two production calls and one test
   stub, which named `appendChild` because that is what the code called.

### The autofix is not the fix

The deferral came from running `oxlint --fix` in bulk and reading its exit code
as success: it had rewritten 320 files, broken 21 typechecks and one test.
Applied deliberately instead, each `prefer-at` site resolves one of three ways,
and only the first is mechanical:

- The result already flows into a `!== undefined` test or an `expect` — swap
  the read and change nothing else.
- The value is provably present but not to the compiler — narrow it once with
  the guard the function already needed, or assert the invariant
  (`chunkByCharBudget emitted an empty group`) per CODING_STANDARDS §5.
- The guard was missing — add it, and record that a bug was found.

**Two of the resulting rewrites were wrong, and the full test suite was green
for both.** `offsetToLineColumn` was rewritten to take the column from `offset`
rather than from the CLAMPED `text.slice(0, offset)`, so every offset past
end-of-text came out one too high. `innerEnd` was rewritten to branch on
truthiness where the original branched on length, so a falsy child would take
the wrong path. Both were caught by running the old and new implementations
against each other over 207 offsets and 7 child shapes — a check that
demonstrably fails, because failing is how it reported these two. A passing
suite is evidence about the suite's coverage, not about a rewrite it never
exercised.

The lesson is the measurement, not the rules. **A rule-adoption probe must run
against the config the repository actually uses.** Probing with categories
disabled does not measure a smaller version of the truth, it measures a
different repository.

## What is not taken from nkzw

`perfectionist/sort-*` needs `eslint-plugin-perfectionist` as a JS plugin, and
sorting is churn against `git blame` for modest gain.
