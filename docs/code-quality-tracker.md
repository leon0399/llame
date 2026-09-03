# Code quality rules

Current thresholds and numeric debt live in
[code-quality-targets.md](code-quality-targets.md). GitHub owns planned work.

- A rule blocks only after owned findings reach zero. No permanent baseline,
  broad allowlist, or directory suppression.
- Vendored rule patches and tests belong in
  [`packages/oxlint-plugin-anti-slop/UPSTREAM.md`](../packages/oxlint-plugin-anti-slop/UPSTREAM.md).
- Reviewer findings are candidates. Verify them against primary tool output or
  by applying the named mutation.
- Tool probes use production configuration. Changed categories/options or
  partial test projects measure a different system.
- Linter/autofix success does not prove typechecks, tests, or behavior. Compare
  old and new logic over representative inputs when a fix rewrites behavior.
- Knip cannot see path-invoked package scripts. Search scripts before deleting
  a finding and register path entrypoints.
- Complexity gates diagnose responsibility problems. Never split functions only
  to satisfy a number.

Current debt is the API CRAP ratchet and unmapped functions in the targets doc.
Other work needs a fresh measurement and issue. `RunExecutionService` remains a
design candidate but any split requires full Postgres integration evidence.
Storybook remains the UI gate until browser coverage exists.
