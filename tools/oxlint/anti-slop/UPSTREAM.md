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

Update by reviewing the upstream diff, running its `install.mjs` into a temporary
directory, and reconciling every local patch above before replacement. Remove a
local patch when upstream carries equivalent coverage. Keep llame-specific
enablement and exceptions in Oxlint configuration, not in the vendored rule
source.
