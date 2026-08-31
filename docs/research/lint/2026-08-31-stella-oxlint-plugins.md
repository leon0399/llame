# What to adopt from stella's oxlint plugins

Noncanonical. Evidence and options for extending llame's lint surface, from a
read of [`stella/stella/.oxlint-plugins`](https://github.com/stella/stella/tree/main/.oxlint-plugins)
(133 rule modules) on 2026-08-31, alongside
[`nkzw-tech/oxlint-config`](https://github.com/nkzw-tech/oxlint-config).

## The headline

**Correction (second pass).** The first version of this note said "most of
stella's 133 rules are domain-specific and are not portable — the portable value
is not the rule list." That was too dismissive, and it was written from rule
NAMES rather than from the inventory. Pulling the actual directory listing, on
the order of 30 rules are domain-agnostic and map onto something llame already
declares. The first pass also wrote a six-rule Tier 1 and shipped exactly one of
them (`no-vacuous-throw-assertion`).

The original point still stands and is worth keeping: **stella enforces in a
linter what llame states in prose.** llame's `AGENTS.md` §Security declares four
invariants and mechanically checks none of them.

## The hard feasibility gate

`node_modules/.pnpm/@oxlint+plugins@1.78.0/node_modules/@oxlint/plugins/index.d.ts:3402`
states verbatim: **"Oxlint does not offer any parser services."** JS plugins get
the AST and nothing else — no type checker, no cross-file resolution. Every rule
below is a SYNTACTIC approximation, and any rule named after a security property
must say so in its own header. Stella's README says the same thing about its own
rules, and that disclaimer is the single most important thing to copy:

> "The text below is a concise contract, not a claim that syntax analysis proves
> more than it does. A rule can prove only the shapes described in its source."
> Security rules "do not replace authorization, runtime validation, or
> integration tests."

## What to adopt, ranked by measured evidence

Third pass: three independent auditors read the catalogue and 40+ rule sources
in full, and every claim below was then re-verified against this repository.
Counts are measured, not estimated.

### The portability question, settled

Of 131 catalogued rule modules: **30 portable as-is, 40 portable with rework,
61 domain-only, 0 blocked on types.** So 70/131 (53%) are reusable in some
form — the first pass's "most are domain-specific" was wrong, and this note's
second pass ("on the order of 30") counted only the strict bucket.

Zero need type information _by design_: stella hit the same wall and routed its
one genuinely type-aware check (`result-consumption.ts`) out of the plugin
system entirely, into a standalone script over `tsc`. Worth remembering if
llame ever wants a type-aware rule.

The 61 domain-only rules are genuinely domain-only, and the reasons are
structural rather than cosmetic: stella runs Bun, Elysia + TypeBox, TanStack
Router, Valkey, and `better-result`. Each mismatch invalidates a whole cluster.

### Tier A — finds a real defect today

1. **`require-timestamptz-column`** — the strongest finding in this audit, and
   one the first two passes missed. llame has **no central `timestamptz()`
   helper**: 36 timestamp columns each repeat `{ withTimezone: true }` by hand,
   so correctness rests on remembering the option, not on the type system. Two
   columns forgot it, and they need different fixes:

   - `apps/api/src/db/schema/auth.ts:27` — `users.emailVerified` is a naive
     `timestamp without time zone`, and it is **live**: `users.service.ts:19`
     maps it into `PublicUserResponse` (`public-user.response.ts:17`). Nothing
     writes it today, so it is always null — but it is in the public API
     contract with the wrong type.
   - `apps/api/src/db/schema/auth.ts:105` — `verificationTokens.expires` is
     also naive, and the table has **zero references outside the schema file**.
     This is vestigial auth.js scaffolding. Under
     [Pre-launch evolution](../../../AGENTS.md#pre-launch-evolution) the
     correct fix is deleting the table, not adding `withTimezone` to it.

   Four other single-line grep hits are false positives — `search.ts:79,82` and
   `auth.ts:70,77` declare `withTimezone: true` on the following line.

2. **`forbid-process-env-outside-env-ts`** — **2 genuine violations** of
   `apps/api/AGENTS.md:87` ("bare env vars are not a config source"):
   `AUTH_RATE_LIMIT_PER_MINUTE` (`auth/constants.ts:18`) and
   `SESSION_COOKIE_DOMAIN` (`auth/auth.controller.ts:253`). 24 non-test reads
   across 15 files total, so the rule needs an allowlist for the real
   boundaries — `NODE_ENV` mode reads, `db.ts`, `main.ts`, `config-loader.ts`
   (which IS the interpolation boundary), and the build/ops entrypoints.

3. **`require-description` on suppressions** — 117 directives repo-wide
   (103 `eslint-disable`, 14 `oxlint-disable`); **49 carry no `--`
   justification**. The undocumented ones cluster in file-level blanket
   disables of type-safety rules at the top of integration suites, the
   highest-risk suppression shape in the repository.

4. **`no-eager-singleton`** — `apps/api/src/db/db.ts` constructs
   `postgres(...)` and `drizzle(client)` at module top level. Plausibly the
   intended canonical singleton, which is what the rule's per-file exemption
   exists for; worth stating deliberately rather than by accident.

### Tier B — zero violations, ratchets a declared invariant

1. **`no-request-derived-rls-identity`** (llame-original). `tenantDb.runAs(X, …)`
   sets `app.current_user_id` (`tenant-db.service.ts:55-66`) across 84 non-test
   call sites, and every controller-layer site traces to `@CurrentUser()`
   (e.g. `runs.controller.ts:79` → `:96`). The rule flags `X` resolving instead
   to a `@Body()` / `@Query()` / `@Param()` parameter, scoped to a single
   controller function — no cross-file dataflow, so it stays sound without
   types.

   **The rule only catches drift; the structural fix is branding.**
   `identity.controller.ts:226` proves a `@Body()`-sourced `userId` legitimately
   exists here — the grant's _subject_, not the caller — so the two meanings
   must be typed apart (`AuthenticatedUserId` vs `string`) before a
   client-supplied identity reaching `runAs` can be a compile error rather than
   a review convention. Stella's `no-unbranded-ownership-id-param` is the
   technique, and it is purely syntactic (it inspects the literal
   `TSStringKeyword` annotation), so only its id-name list is domain config.

2. **Module-ownership boundaries.** `apps/api/AGENTS.md` states "`src/queue/` —
   consumed **only** by `runs/`" and `apps/web/lib/api/AGENTS.md` states that
   only `lib/services/` and `lib/api/` may import generated modules. Both are
   import-specifier allowlists, the shape of stella's `confine-redis-client`.
   The queue boundary has 0 violations; the generated-client boundary has
   **1 production violation** — `apps/web/app/(chat)/components/effort-selector.tsx:17`
   imports `EffortLevelResponse` from `@/lib/api/generated/models`. It is a
   type-only import and the doc carves out no exception, so the first decision
   is whether type-only imports are exempt. The other four hits are test files.

3. **`no-unsafe-inner-html`** — 4 production `dangerouslySetInnerHTML` sites,
   each plausibly justified (shiki output, a prehydration script) and none
   stating why.

4. **`require-escape-like`, `no-inline-style-colors`, `no-offset-pagination`,
   `no-auth-token-in-web-storage`, `no-raw-stored-json`,
   `require-cached-collator`, `no-partial-record-satisfies`,
   `require-safe-window-open`, `no-async-context-enter-with`** — all 0
   violations. Cheap ratchets that lock in practices llame already follows.

### Judgement calls, not defects

- **`no-swallowed-rejection`** — 67 raw `.catch(() => <literal>)` sites, but
  most are MCP teardown (`.cancel()`, `.close()`) that stella's own rule
  allowlists, because there the fallback IS the handling. The one production
  site worth a human decision is
  `apps/web/lib/services/chat/export.ts:58` — `fetchModels().catch(() => undefined)`,
  which degrades the export to omit model names. That reads deliberate; it is
  a design question, not a bug.
- **`no-document-cookie`** — 2 hits, both the vendored shadcn sidebar's own
  UI-state cookie. Needs a file exemption, not a fix.
- **`no-detached-void`** — 49 raw `void <expr>` sites, many idiomatic
  (`void bootstrap()`). Not adoptable without first introducing a `detached()`
  helper.

### Rejected, with the evidence

- **`no-foreign-directive`** — low value here. oxlint honors `eslint-disable`
  as equivalent to `oxlint-disable`, including in unused-directive tracking
  (verified by controlled probe, from two directions). llame's 103
  `eslint-disable` directives across 49 files are live, functioning
  suppressions in another toolchain's spelling — cosmetic drift, not a
  correctness gap. Both earlier versions of this note were wrong about this:
  the first claimed the drift was confined to one file, the second reasoned
  from a single probe.
- **`no-body-ownership-ids` ported verbatim** — fires on all 141
  `input.userId`-shaped reads in `apps/api`, nearly all service-internal and
  legitimate. Superseded by Tier B #1, which anchors on `runAs` instead.
- **`no-secret-in-log-sink`** — a closed 9-name identifier allowlist whose own
  header admits an aliased secret slips past. llame's `protected-values.ts`
  already protects by _resolved value_ rather than property name, which is
  strictly stronger. Porting it would be a downgrade.
- **`security-guards` / `require-search-scope`** — enforce app-level per-query
  tenant scoping. llame's stated principle is RLS-first ("enforce isolation in
  the datastore, not just app code"), so adopting these would promote the
  secondary defense to primary. A design tension, not a feasibility gap.
- **Nothing in the 133 matches llame's RLS invariants.** Stella's tenancy is
  app-level RBAC, so `FORCE ROW LEVEL SECURITY` and `SECURITY DEFINER`
  ownership have no counterpart to borrow. That is a gap in the source
  material, and it is why Tier B #1 had to be written rather than ported.

## The practices are worth more than the rules

Still true, and the third pass found the biggest one.

### 1. Twelve of llame's eighteen anti-slop rules have NO regression protection

Measured: 6 rules have a `RuleTester` `*.test.ts`
(`no-chained-type-assertions`, `no-module-mocking`, `no-unknown-parameters`,
`no-untracked-todo`, `no-vacuous-throw-assertion`,
`parameter-decorator-own-line`). The other 12 have neither a test nor a live
suppression that would go stale — **zero** coverage of any kind:

`no-conditional-empty-object-spread`, `no-known-value-widening`,
`no-object-parameters`, `no-reflect-apply`, `no-reflect-get`,
`no-runtime-typeof`, `no-shape-in-symbol-names`, `no-unknown-returns`,
`no-unknown-type-aliases`, `no-unsafe-dictionary-type`, `no-widen-then-assert`,
`require-safety-comment-for-type-assertion`.

Any of those twelve could silently stop detecting anything and nothing would
notice. Stella covers 133/133 rules at roughly ten lines each, because its
fixture IS the test: one intentionally suppressed violation plus a few accepted
lines, checked by `oxlint --report-unused-disable-directives-severity=error`
over a fixtures directory. If the detector goes silent the directive becomes
unused and CI fails; if it starts false-positiving, an accepted line fails under
`--deny-warnings`. A whole fixture is this:

```ts
// oxlint-disable-next-line no-nanoid/no-nanoid -- fixture proves a side-effect
// import cannot reintroduce the removed dependency
import "nanoid";
const generatedId = Bun.randomUUIDv7();
```

**Correction to this note's earlier claim that the fixture trick "works today at
no cost."** It costs nothing in machinery — llame already runs the flag
everywhere — but it yields nothing until a directive exists, and llame has zero
`oxlint-disable` directives for any anti-slop rule. The protection has to be
authored.

RuleTester is strictly more precise where it exists (named cases, `messageId`
assertions, a reviewable spec). The right move is fixtures for the twelve
untested rules, not a wholesale swap.

### 2. No rule catalogue exists

`packages/oxlint-plugin-anti-slop/` has `UPSTREAM.md` (which documents only the
three vendored patches) and per-rule `meta.docs.description` one-liners. There
is nothing browsable, no domain grouping, and — most importantly — no honesty
disclaimer. Stella's is the single most valuable paragraph in that repository
and should be copied in spirit:

> "The text below is a concise contract, not a claim that syntax analysis proves
> more than it does. A rule can prove only the shapes described in its source."
> Security rules "do not replace authorization, runtime validation, or
> integration tests."

A rule named for a security property invites the belief that the property is
proven. Cheapest item on this list; one README.

### 3. The registry check stops one step short

`registry.check.mjs` verifies `rules/*.ts` ↔ the index rules map, and nothing
else. It never reads `.oxlintrc.json`, so a rule can be written, tested,
registered, and still not switched on. All 18 are enabled today, so the gap is
latent — but it is the same failure the check's own header describes ("an import
landed while its map entry silently did not... looking installed"), one step
further out. Stella's equivalent checks eleven properties per rule, including
enabled-in-production-config. Adding that one regex pass is cheap and closes the
real gap.

### 4. The ratchet is broader than described, and does not compose

`scripts/ratchet.ts` is a **general whole-repo metrics ratchet** with
decrease-only baselines for any line counter, not just suppressions — and it has
**four** suppression tiers (`security`, `data-volume`, `observability`,
`test-integrity`), where only `security` additionally requires a waiver-ledger
entry, and budgets are partitioned so a style cleanup cannot fund a new security
waiver. This note's earlier description ("security-tier suppressions require a
waiver") missed three of the four tiers.

It does **not** compose with `--report-unused-disable-directives`: it runs its
own regex scanner over raw source and needs its own baseline file. The two ask
different questions — oxlint asks "is this directive used", the ratchet asks
"did the repo-wide count rise". Given llame's current suppression volume this is
insurance against future creep, not a present gap. Lowest priority here.

### 5. A grandfather ledger for `no-module-mocking`

Stella pairs `no-internal-module-mock` with
`scripts/internal-module-mock-ledger.json`: legacy exceptions are listed, the
list can only shrink, and an entry whose mock disappears is reported as stale so
the ledger gets cleaned up. This note already said stella's boundary was "worth
importing" without naming a mechanism. This is the mechanism.

### 6. Retire a custom rule when a native one covers it

Stella's README has a "Native and shared rules" section recording custom rules
it deleted once oxlint natives covered them. llame has no equivalent prompt to
re-ask "is this native yet?", and it now declares 215 rules.

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
