# Upstream provenance

This directory is vendored from
[`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop) commit
`446268e5d15baa968eaec669ff65358d36ae6259`.

- Source path: `skills/install-anti-slop/assets/anti-slop/`
- License: MIT; retained in [`LICENSE`](LICENSE)
- Local rule-source changes: none; `package.json` marks the vendored TypeScript
  boundary as ESM for Node's plugin loader

Update by reviewing the upstream diff, running its `install.mjs` into a temporary
directory, and replacing this directory only after the standard llame lint gates
pass. Keep llame-specific enablement and exceptions in Oxlint configuration, not
in the vendored rule source.
