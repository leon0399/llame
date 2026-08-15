# Anti-slop foundation implementation plan

> **Goal:** Replace the bespoke chained-assertion gate with the upstream
> anti-slop Oxlint plugin, enforce the three currently clean rules across every
> owned TypeScript/JavaScript scope, and preserve an exact zero baseline.

## Scope and decisions

- Pin the vendored rule source to `dmmulroy/anti-slop@446268e` and retain its
  MIT license plus explicit provenance.
- Vendor the source instead of installing the Git package. The exact-SHA
  package probe failed with Node's
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` because upstream exports
  TypeScript directly from `node_modules`; building a private package fork would
  create more ownership than vendoring the reviewed source.
- Pair `oxlint` and `@oxlint/plugins` at exact version 1.77.0, and satisfy
  Oxlint's type-aware peer with mature `oxlint-tsgolint` 7.0.2001. The upstream
  sample violation passes the compatibility probe, while 1.77.0 satisfies the
  repository's seven-day release-age policy without an exception. Do not bypass
  that policy merely to use 1.78.0 two days early.
- Enable only the three rules measured at zero across API, web, Storybook, UI,
  root E2E, and `playwright.config.ts`:
  `no-chained-type-assertions`, `no-unknown-type-aliases`, and
  `no-widen-then-assert`.
- Delete the two superseded double-assertion ast-grep rules. Keep ast-grep and
  its constructor-decorator rule; that rule still owns a distinct syntax
  convention.
- Do not add a baseline, file-level override, generated report, custom wrapper,
  or repository-specific rule-test harness.

## Measured follow-up inventory

The remaining twelve rules report 1,125 diagnostics across the five owned lint
scopes. This PR records the inventory but does not mix remediation into the
tooling layer.

| Rule                                        | Diagnostics | Files |
| ------------------------------------------- | ----------: | ----: |
| `no-conditional-empty-object-spread`        |         147 |    50 |
| `no-known-value-widening`                   |          47 |    30 |
| `no-module-mocking`                         |          81 |    34 |
| `no-object-parameters`                      |           3 |     3 |
| `no-reflect-apply`                          |           2 |     1 |
| `no-reflect-get`                            |           4 |     4 |
| `no-runtime-typeof`                         |         202 |    77 |
| `no-shape-in-symbol-names`                  |           5 |     3 |
| `no-unknown-parameters`                     |         142 |    64 |
| `no-unknown-returns`                        |          18 |    15 |
| `no-unsafe-dictionary-type`                 |          88 |    50 |
| `require-safety-comment-for-type-assertion` |         386 |   142 |

## Task 1: Install the maintained plugin boundary

- [x] Vendor the upstream installation asset under
      `tools/oxlint/anti-slop/`, add its license and provenance, and exclude only
      that third-party source from repository formatting.
- [x] Add exact root development dependencies for `oxlint` and
      `@oxlint/plugins`, update the shared Oxlint catalog and API tsgolint peer, and
      regenerate the pnpm lockfile with the repository's package manager.
- [x] Verify the vendored plugin loads under Node 22 and Oxlint 1.77.0 using the
      standard Oxlint CLI; do not add a custom test runner.

## Task 2: Enforce the zero-baseline rules everywhere

- [x] Register the vendored plugin and the three rules in all four workspace
      Oxlint configurations.
- [x] Add a root Oxlint configuration and `lint:root` task for `e2e/` and
      `playwright.config.ts`.
- [x] Register `//#lint:root` as the repository-wide Turborepo root task and
      make workspace `lint` depend on it. Include the shared vendor path in every
      workspace lint hash and preserve the existing `turbo run lint` CI entrypoint.
- [x] Add a scoped Lefthook root-lint job for staged root E2E/config/tooling
      changes.
- [x] Delete only `rules/no-double-assertion-through-unknown-ts.yml` and
      `rules/no-double-assertion-through-unknown-tsx.yml`; retain and rerun the
      decorator-placement rule.

## Task 3: Verify and publish the stack layer

- [x] Run all five Oxlint scopes with zero findings. Run the aggregate Turbo
      lint foreground with `--concurrency=1` to protect the workstation.
- [x] Run `pnpm lint:ast-grep`, `pnpm lint:markdown`, focused Prettier, lockfile
      verification, and workflow lint for every changed workflow/config surface.
- [x] Update `docs/testing.md`, `docs/code-quality-tracker.md`, and
      `CHANGELOG.md` with the replacement boundary, exact inventory, and next
      remediation order. Revise root/API instructions and the approved unsafe-
      assertion design so no canonical contract still assigns the chained-assertion
      gate to ast-grep or rejects the now-proven vendor route.
- [x] Obtain specification-compliance and code-quality review; repair every
      factual or P0/P1 defect.
- [ ] Commit with conventional messages and the required co-author trailer,
      publish a non-draft stacked PR above #401, reference applicable issues, and
      monitor its final head to green without merging.
