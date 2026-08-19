# Upstream provenance

The base of this directory is vendored from
[`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop) commit
`446268e5d15baa968eaec669ff65358d36ae6259`.

- Source path: `skills/install-anti-slop/assets/anti-slop/`
- License: MIT; retained in [`LICENSE`](LICENSE)
- `package.json` marks the vendored TypeScript boundary as ESM for Node's plugin
  loader; `tsconfig.json` applies upstream's strict compiler settings to the
  installed asset and its local regression.
- Local correctness patch: `no-chained-type-assertions` treats
  `TSNonNullExpression` as a transparent wrapper. Without it,
  `(value as unknown)! as Target` bypasses the rule. The standard Oxlint
  `RuleTester` regression lives beside the rule. Upstream `main` was still the
  pinned commit when the patch was added on 2026-08-15.
- Local correctness patch: `no-unknown-parameters` exempts a type predicate's
  own subject parameter (`function isFoo(value: unknown): value is Foo`).
  TypeScript requires that parameter to be typed `unknown` for the guard to
  be sound — no narrower type satisfies it — so this is the canonical
  legitimate use the rule exists to funnel code toward, mirrored by
  upstream's own `cause` carve-out for the same reason. Only the parameter
  the predicate names is exempted; a second `unknown` parameter in the same
  signature, or a predicate on a different parameter, is still flagged. The
  standard Oxlint `RuleTester` regression lives beside the rule. Upstream
  `main` was still the pinned commit when the patch was added on 2026-08-19.
- Local correctness patch: `no-unknown-parameters` gains an options schema,
  mirroring `no-runtime-typeof`'s `allowInTypeGuards` shape (both booleans,
  default `false`, opt-in per Oxlint config). Upstream's own exemption
  mechanism for this rule is already a hardcoded parameter name (`cause`), so
  a configurable exemption is consistent with its design, not a departure
  from it.
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
    covering both options' exempted and still-flagged (negative) cases.
    Upstream `main` was still the pinned commit when the patch was added on
    2026-08-19.

Update by reviewing the upstream diff, running its `install.mjs` into a temporary
directory, and reconciling every local patch above before replacement. Remove a
local patch when upstream carries equivalent coverage. Keep llame-specific
enablement and exceptions in Oxlint configuration, not in the vendored rule
source.
