# Storybook Visual Tests Public Preview Implementation Plan

**Document version:** v4

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the addon for a narrow public `0.x` preview while developing
and testing it inside the llame monorepo, with repository extraction remaining
an optional final release step.

**Architecture:** Keep Storybook's development server as the trusted local
control plane. Separate server-only state from channel-visible state, verify the
consumer boundary through an in-repository fixture template executed under
`/tmp` outside the workspace, and publish only a compiled, allowlisted artifact.
Support stays deliberately narrow until compatibility is demonstrated by that
fixture.

**Tech Stack:** TypeScript, Storybook 10, React, Vite, Playwright Chromium,
Vitest, pnpm, Turborepo, npm trusted publishing.

---

## Release contract

The first public preview is not a general visual-testing platform. It supports:

- local, development-only Storybook;
- Storybook and Playwright running in the same network namespace;
- direct loopback HTTP access to Storybook;
- one explicitly tested Storybook 10 minor range;
- React with the Vite framework integration;
- bundled Playwright Chromium at `1280x720`, DPR 1;
- only operating systems whose baseline-transfer behavior is explicitly proven;
- source-adjacent baseline review and approval;
- static Storybook rendering the panel as unavailable.

The initial release does not promise HTTPS, reverse-proxy path prefixes,
container-separated capture, remote approval, multiple browsers, viewport
matrices, theme matrices, masking, or a CI runner.

Git diff, commit review, and pull-request review remain the authorization
boundary for accepting baseline changes. The addon validates candidate
integrity; it does not authenticate the human issuing a command through a
development Storybook manager.

## File map

Expected files are listed up front so package boundaries remain explicit.
Exact paths may be narrowed during implementation, but additional production
files require a task-level justification.

- `src/constants.ts` — public addon, event, route, and bridge identifiers.
- `src/shared/results.ts` — channel-visible result and state types.
- `src/node/runner.ts` — server-only result state, capture lifecycle, and
  artifact cleanup.
- `src/node/server.ts` — typed server-to-manager serialization boundary.
- `src/node/capture.ts` — capture URL construction and actionable connection
  errors.
- `src/preset.ts` — preset options and supported local capture origin.
- `src/manager.tsx`, `src/manager/Panel.tsx` — consume only public wire types.
- `src/manager/PanelView.tsx` — user-visible error and review behavior.
- `test/protocol.test.ts`, `test/runner.test.ts`, `test/compare.test.ts`,
  `test/server.test.ts`, `test/capture.test.ts` — focused unit contracts.
- `test/fixtures/consumer/` — minimal external React-Vite Storybook project,
  copied outside the workspace for packed-artifact tests.
- `test/consumer/` — tarball build/install/dev/static-build orchestration.
- `test/smoke/addon.spec.ts` — browser-visible release acceptance path.
- `package.json` — build, exports, files allowlist, public metadata, peer
  contract, and pack checks.
- `tsconfig.build.json` or the selected build-tool configuration — distributable
  ESM and declarations, excluding tests and stories.
- `README.md`, `docs/configuration.md`, `docs/capture-contract.md` — verified
  public contract, security boundary, and troubleshooting.
- `.github/workflows/ci.yml` — packed-consumer release gate.
- `.github/workflows/release-storybook-addon-visual-tests.yml` — protected,
  provenance-producing publication.
- `LICENSE` — license grant, added no later than the release-metadata task.

## Chunk 1: Stabilize the public contract

### Task 1: Replace llame-specific runtime identifiers

**Files:**

- Modify: `packages/storybook-addon-visual-tests/src/constants.ts`
- Modify: `packages/storybook-addon-visual-tests/src/preview.ts`
- Modify: `packages/storybook-addon-visual-tests/src/node/capture.ts`
- Modify: identifier-dependent tests under
  `packages/storybook-addon-visual-tests/test/`

- [x] **Step 1: Add failing identifier-contract tests**

  Assert that addon IDs, channel events, artifact routes, and the preview bridge
  use one generic namespace and contain neither `llame` nor `workspace`.

- [x] **Step 2: Run the focused tests and verify they fail**

  Run:

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests test constants protocol preview server capture
  ```

  Expected: failure because current identifiers use `llame` and
  `__LLAME_VISUAL_TESTS__`.

- [x] **Step 3: Rename the identifiers as one atomic protocol change**

  Use the final public package namespace consistently. Do not add compatibility
  aliases: no public version depends on the old names.

- [x] **Step 4: Run focused and package checks**

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests test
  pnpm --filter @workspace/storybook-addon-visual-tests typecheck
  pnpm --filter @workspace/storybook-addon-visual-tests lint
  ```

  Expected: all pass.

- [x] **Step 5: Verify internal branding is gone from runtime surfaces**

  ```bash
  rg -n "llame|LLAME|@workspace" \
    packages/storybook-addon-visual-tests/src \
    packages/storybook-addon-visual-tests/test \
    --glob '!test/fixtures/**'
  rg -n "llame|LLAME" \
    packages/storybook-addon-visual-tests/test/fixtures
  ```

  Expected: no runtime identifier or non-fixture test import matches. Fixtures
  contain no llame-specific branding; their workspace-scoped imports may remain
  only until the packed-consumer task.

- [x] **Step 6: Commit**

  ```bash
  git add packages/storybook-addon-visual-tests/src \
    packages/storybook-addon-visual-tests/test
  git commit -m "refactor(storybook-addon): genericize runtime identifiers"
  ```

### Task 2: Separate server-only and channel-visible state

**Files:**

- Modify: `packages/storybook-addon-visual-tests/src/shared/results.ts`
- Modify: `packages/storybook-addon-visual-tests/src/node/runner.ts`
- Modify: `packages/storybook-addon-visual-tests/src/node/server.ts`
- Modify: `packages/storybook-addon-visual-tests/src/manager.tsx`
- Modify: `packages/storybook-addon-visual-tests/src/manager/Panel.tsx`
- Test: `packages/storybook-addon-visual-tests/test/server.test.ts`
- Test: `packages/storybook-addon-visual-tests/test/protocol.test.ts`

- [x] **Step 1: Add failing serialization/type-contract tests**

  Prove that server-owned results contain `importPath` while emitted manager
  state cannot contain or access it.

- [x] **Step 2: Run focused tests and typecheck**

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests test server protocol
  pnpm --filter @workspace/storybook-addon-visual-tests typecheck
  ```

  Expected: the new contract fails because manager payloads are currently typed
  as `VisualRunState` even though `publicState()` removes `importPath`.

- [x] **Step 3: Introduce explicit internal and public state types**

  Keep story import paths exclusively in the Node runner. Convert once at the
  server channel boundary. Do not accept an import path from browser commands.

- [x] **Step 4: Run package checks**

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests test
  pnpm --filter @workspace/storybook-addon-visual-tests typecheck
  pnpm --filter @workspace/storybook-addon-visual-tests lint
  ```

  Expected: all pass.

- [x] **Step 5: Commit**

  ```bash
  git add packages/storybook-addon-visual-tests/src \
    packages/storybook-addon-visual-tests/test
  git commit -m "fix(storybook-addon): type the public channel boundary"
  ```

### Task 3: Remove misleading passing diff artifacts

**Files:**

- Modify: `packages/storybook-addon-visual-tests/src/node/compare.ts`
- Modify: `packages/storybook-addon-visual-tests/src/node/runner.ts`
- Modify: `packages/storybook-addon-visual-tests/src/manager/PanelView.tsx`
- Test: `packages/storybook-addon-visual-tests/test/compare.test.ts`
- Test: `packages/storybook-addon-visual-tests/test/runner.test.ts`

- [ ] **Step 1: Add failing artifact-lifecycle tests**

  Cover pixel-identical passes, changed pixels, metadata-only incompatibility,
  and removal/non-registration of a stale previous diff.

- [ ] **Step 2: Run focused tests and verify failure**

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests test compare runner
  ```

  Expected: pixel-identical comparisons currently return and register a diff.

- [ ] **Step 3: Emit diffs only for pixel changes**

  Keep baseline and candidate review available for metadata incompatibility, but
  do not display a zero-information diff. Ensure a later passing run cannot
  expose a stale diff artifact.

- [ ] **Step 4: Run package and Storybook UI verification**

  Follow the repository Storybook MCP instructions before changing the rendered
  panel. Run the affected story tests and preview the affected panel stories,
  then run:

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests test
  pnpm --filter @workspace/storybook-addon-visual-tests typecheck
  pnpm --filter @workspace/storybook-addon-visual-tests lint
  ```

  Expected: all pass; a passing result exposes no Diff tab.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/storybook-addon-visual-tests/src \
    packages/storybook-addon-visual-tests/test
  git commit -m "fix(storybook-addon): emit diffs only for changed pixels"
  ```

## Chunk 2: Prove supported behavior

### Task 4: Define the target compatibility and trust contract

**Files:**

- Modify: `packages/storybook-addon-visual-tests/README.md`
- Modify: `packages/storybook-addon-visual-tests/docs/configuration.md`
- Modify: `packages/storybook-addon-visual-tests/docs/capture-contract.md`
- Modify: `packages/storybook-addon-visual-tests/package.json`
- Modify: `packages/storybook-addon-visual-tests/src/preset.ts`
- Test: `packages/storybook-addon-visual-tests/test/server.test.ts`

- [x] **Step 1: Write the target support matrix**

  Record the Node, Storybook, React, framework, browser, operating-system, and
  network-topology combinations that Tasks 8 and 10 must prove. Mark these as
  release targets, not verified support, until the packed-consumer matrix passes.
  Treat cross-OS baseline portability separately from “the addon starts on both
  operating systems”: a baseline approved on one claimed OS must be rerun on
  every other claimed OS under the same environment key.

- [x] **Step 2: Document the trusted-development-interface boundary**

  Explain that any party with development manager-channel access may issue
  capture and approval commands, approval writes repository files, candidate
  integrity checks are not user authentication, and Git/PR review authorizes
  committed baseline changes.

- [x] **Step 3: Document the capture origin**

  State that zero-config capture uses direct loopback HTTP in the same network
  namespace. List HTTPS, proxy prefixes, and split-container operation as
  unsupported rather than silently implying compatibility.

- [x] **Step 4: Define and test preset option validation**

  Add failing tests proving `storyRoots` must be a non-empty array of non-empty
  strings and `maxConcurrency`, when present, must be a number that is finite,
  integer, and greater than zero. Cover wrong JavaScript runtime types, empty
  strings, mixed arrays, zero, negative, fractional, NaN, and infinite values.
  Make preset startup reject invalid values with actionable errors. Keep the
  default concurrency at 2; do not invent a configurable upper bound without
  evidence.

- [x] **Step 5: Document every supported option and default**

  Include `storyRoots`, `maxConcurrency`, capture framing, disable semantics,
  comparator policy, artifact ignores, and failure behavior.

- [x] **Step 6: Verify target docs and metadata agree**

  ```bash
  rg -n "Storybook|React|Node|Chromium|HTTP|storyRoots|maxConcurrency" \
    packages/storybook-addon-visual-tests/README.md \
    packages/storybook-addon-visual-tests/docs \
    packages/storybook-addon-visual-tests/package.json
  pnpm format:check
  ```

  Expected: one consistent target matrix with an explicit “verified by release
  CI before publication” status; formatting passes. Final peer ranges and
  support wording are set only after Task 8 supplies evidence.

- [x] **Step 7: Commit**

  ```bash
  git add packages/storybook-addon-visual-tests/README.md \
    packages/storybook-addon-visual-tests/docs \
    packages/storybook-addon-visual-tests/package.json \
    packages/storybook-addon-visual-tests/src/preset.ts \
    packages/storybook-addon-visual-tests/test/server.test.ts
  git commit -m "docs(storybook-addon): define the public preview contract"
  ```

### Task 5: Expand consumer-visible browser acceptance coverage

**Files:**

- Modify: `packages/storybook-addon-visual-tests/test/fixtures/project/src/visual-fixture.stories.tsx`
- Modify: `packages/storybook-addon-visual-tests/test/smoke/addon.spec.ts`
- Modify: supporting fixture files under
  `packages/storybook-addon-visual-tests/test/fixtures/project/`

- [ ] **Step 1: Add one failing browser case at a time**

  Prioritize:

  1. changed pixels with baseline/candidate/diff review;
  2. disabled story with no candidate;
  3. viewport and content framing;
  4. story outside `storyRoots`;
  5. stale approval rejection;
  6. malformed baseline metadata;
  7. cancellation without an approval-capable partial result;
  8. browser-launch or connection failure with actionable text;
  9. static Storybook panel unavailable state;
  10. testing-widget run-all over at least two stories, including one
      disabled/error result, with correct aggregate completion;
  11. baseline transfer between every pair of claimed operating systems.

  The cross-OS case must create and approve a baseline archive on OS A, transfer
  those exact baseline bytes and metadata to OS B, and rerun without approval.
  Independently creating a baseline on each runner does not prove portability.
  If transfer fails, narrow the preview support contract to one OS. OS-specific
  environment identities change baseline paths and review semantics and require
  a separate design; do not improvise them inside this release task.

- [ ] **Step 2: Run locally executable cases and verify their initial failure**

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests test:visual --grep "<case>"
  ```

  Expected for cases 1–10: each new assertion fails before its corresponding
  minimal production or fixture change.

- [ ] **Step 3: Prove the cross-OS transfer harness with a negative control**

  Locally test that the transfer harness rejects a missing, truncated, or
  mismatched baseline archive. Do not require a single-host cross-OS product
  failure: the real OS A→B result is first measured in Task 10 CI and may pass
  without a production change.

- [ ] **Step 4: Make the minimal behavior or fixture change**

  Do not duplicate unit tests in Playwright unless the browser-visible
  projection or filesystem effect is part of the public contract.

- [ ] **Step 5: Run the full addon verification**

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests test
  pnpm --filter @workspace/storybook-addon-visual-tests test:visual
  pnpm --filter @workspace/storybook-addon-visual-tests typecheck
  pnpm --filter @workspace/storybook-addon-visual-tests lint
  ```

  Expected: all pass.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/storybook-addon-visual-tests/test \
    packages/storybook-addon-visual-tests/src
  git commit -m "test(storybook-addon): cover public visual workflows"
  ```

## Chunk 3: Validate the package boundary inside the monorepo

### Task 6: Produce compiled ESM and declarations

**Files:**

- Modify: `packages/storybook-addon-visual-tests/package.json`
- Create: `packages/storybook-addon-visual-tests/tsconfig.build.json` or the
  selected minimal build-tool configuration
- Modify: `packages/storybook-addon-visual-tests/src/preset.ts`
- Test: package export-resolution tests under
  `packages/storybook-addon-visual-tests/test/`

- [ ] **Step 1: Add a failing built-export resolution test command**

  Add `pack:artifact -- <absolute-tgz-path>` as the single-purpose archive
  creator used by later tasks. Add `test:exports -- <absolute-tgz-path>` that
  installs a supplied package artifact into a minimal temporary Node project and
  asserts that the root, manager, preset, and preview exports resolve to
  JavaScript while their declaration targets exist under `dist`. The test must
  never pack implicitly and must reject resolved `.ts`/`.tsx` source and
  workspace paths.

- [ ] **Step 2: Run the test and verify failure**

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests pack:artifact -- \
    /tmp/storybook-addon-visual-tests/export-red.tgz
  pnpm --filter @workspace/storybook-addon-visual-tests test:exports -- \
    /tmp/storybook-addon-visual-tests/export-red.tgz
  ```

  Expected: assertion failure because current exports resolve to raw TypeScript
  source and declarations under `dist` do not exist. A missing script is not an
  acceptable red result.

- [ ] **Step 3: Add the smallest build pipeline**

  Emit ESM and declarations while preserving separate manager, preview, preset,
  and Node/shared modules. Exclude tests, stories, temporary artifacts, and
  package-private configuration. Ensure the compiled preset resolves compiled
  manager and preview files.

- [ ] **Step 4: Point exports at built output**

  Add explicit `types` and `import` conditions. Do not export internal Node
  modules unless a public consumer requirement exists.

- [ ] **Step 5: Verify build and package checks**

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests build
  pnpm --filter @workspace/storybook-addon-visual-tests pack:artifact -- \
    /tmp/storybook-addon-visual-tests/export-green.tgz
  pnpm --filter @workspace/storybook-addon-visual-tests test:exports -- \
    /tmp/storybook-addon-visual-tests/export-green.tgz
  pnpm --filter @workspace/storybook-addon-visual-tests typecheck
  pnpm --filter @workspace/storybook-addon-visual-tests test
  pnpm --filter @workspace/storybook-addon-visual-tests lint
  ```

  Expected: all pass and `dist` contains only intended runtime/declaration
  output.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/storybook-addon-visual-tests
  git commit -m "build(storybook-addon): emit public package artifacts"
  ```

### Task 7: Control and inspect the npm tarball

**Files:**

- Modify: `packages/storybook-addon-visual-tests/package.json`
- Create: a tarball-inventory assertion under
  `packages/storybook-addon-visual-tests/test/consumer/`

- [ ] **Step 1: Add separate artifact creation and inspection commands**

  Add `pack:artifact -- <absolute-tgz-path>` as the only command that creates an
  archive. Add `test:pack -- <absolute-tgz-path>` as a read-only inspector that
  rejects source, tests, stories, `.turbo`, `test-results`, temporary Storybook
  output, candidate/diff images, internal agent/design documents, or an archive
  over the explicit size budget. `test:pack` must never rebuild or repack.

- [ ] **Step 2: Verify the current package fails**

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests pack:artifact -- \
    /tmp/storybook-addon-visual-tests/pack-red.tgz
  pnpm --filter @workspace/storybook-addon-visual-tests test:pack -- \
    /tmp/storybook-addon-visual-tests/pack-red.tgz
  ```

  Expected: assertion failure naming unwanted repository/generated entries. A
  missing script is not an acceptable red result.

- [ ] **Step 3: Add a strict `files` allowlist and `prepack` gate**

  Ship only compiled output, README, LICENSE, and package metadata required by
  npm.

- [ ] **Step 4: Inspect the resulting archive**

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests pack:artifact -- \
    /tmp/storybook-addon-visual-tests/pack-green.tgz
  pnpm --filter @workspace/storybook-addon-visual-tests test:pack -- \
    /tmp/storybook-addon-visual-tests/pack-green.tgz
  ```

  Expected: the assertion inspects the supplied archive without mutating it,
  every file is allowlisted, and the archive stays within the documented size
  budget.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/storybook-addon-visual-tests/package.json \
    packages/storybook-addon-visual-tests/test/consumer
  git commit -m "build(storybook-addon): constrain the published tarball"
  ```

### Task 8: Run an in-repo fixture outside the workspace

**Files:**

- Create: `packages/storybook-addon-visual-tests/test/fixtures/consumer/`
- Create: `packages/storybook-addon-visual-tests/test/consumer/`
- Modify: `packages/storybook-addon-visual-tests/package.json`
- Modify: `packages/storybook-addon-visual-tests/playwright.config.ts`
- Modify: `packages/storybook-addon-visual-tests/turbo.json`

- [ ] **Step 1: Create a minimal React-Vite Storybook fixture template**

  Keep fixture dependencies explicit. It must not reference `workspace:*`,
  root catalogs, llame source aliases, or a TypeScript runtime loader for addon
  code.

- [ ] **Step 2: Add the executable `test:consumer -- <absolute-tgz-path>` harness**

  The fixture template lives in-repo, but execution must:

  1. create a directory with `mktemp -d` under `/tmp`;
  2. use the repository's pinned Corepack/pnpm version;
  3. copy only the consumer fixture template;
  4. receive the absolute path of the exact `.tgz` created by `pack:artifact`;
  5. install that archive through an absolute `file:` dependency;
  6. install Playwright Chromium for the fixture;
  7. assert the resolved addon package and every public export live below the
     temporary project's `node_modules`, never the llame workspace;
  8. run Storybook dev, browser acceptance, and Storybook static build;
  9. clean the temporary directory on success, failure, and interruption.

- [ ] **Step 3: Prove workspace-isolation detection with a negative control**

  Point a dedicated negative-control fixture dependency at the workspace package
  rather than the supplied archive and assert that the harness rejects its
  resolved path before starting Storybook. Restore the real fixture immediately;
  this validates the isolation guard without inventing a product defect that
  Task 6 already fixed. Run:

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests test:consumer:negative
  ```

  Expected: a specific assertion identifies the workspace-resolved addon.
  Harness/bootstrap failure is not an acceptable result.

- [ ] **Step 4: Exercise the public workflow against the installed tarball**

  Cover dev startup, run, review, approve, changed diff, rerun pass, and static
  build unavailable behavior. Through the installed manager/provider exports,
  initiate testing-widget run-all over at least two stories, include one
  disabled/error result, and assert aggregate completion.

- [ ] **Step 5: Run the complete package gate**

  ```bash
  pnpm --filter @workspace/storybook-addon-visual-tests build
  pnpm --filter @workspace/storybook-addon-visual-tests pack:artifact -- \
    /tmp/storybook-addon-visual-tests/consumer.tgz
  pnpm --filter @workspace/storybook-addon-visual-tests test:exports -- \
    /tmp/storybook-addon-visual-tests/consumer.tgz
  pnpm --filter @workspace/storybook-addon-visual-tests test:pack -- \
    /tmp/storybook-addon-visual-tests/consumer.tgz
  pnpm --filter @workspace/storybook-addon-visual-tests test
  pnpm --filter @workspace/storybook-addon-visual-tests test:visual
  pnpm --filter @workspace/storybook-addon-visual-tests test:consumer -- \
    /tmp/storybook-addon-visual-tests/consumer.tgz
  pnpm --filter @workspace/storybook-addon-visual-tests typecheck
  pnpm --filter @workspace/storybook-addon-visual-tests lint
  ```

  Expected: all artifact-dependent checks consume the exact archive created once
  by `pack:artifact`.

- [ ] **Step 6: Run the target combination locally**

  Parameterize the consumer harness over the target Storybook and React versions
  available under the repository's Node version. Assert installation emits no
  unexpected peer-dependency warnings. This proves the harness locally; Task 10
  owns multi-Node/OS CI evidence and final support wording.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/storybook-addon-visual-tests
  git commit -m "test(storybook-addon): verify the packed consumer boundary"
  ```

## Chunk 4: Prepare and publish the preview

### Task 9: Add public metadata, license, and release documentation

**Files:**

- Modify: `packages/storybook-addon-visual-tests/package.json`
- Modify: `packages/storybook-addon-visual-tests/README.md`
- Create: `packages/storybook-addon-visual-tests/LICENSE` or use the repository
  root license if its grant and npm inclusion are explicit
- Create: package-specific changelog/release notes only if the chosen release
  process requires them

- [ ] **Step 1: Choose the final package name and license**

  Verify the authenticated npm identity, scope ownership, and package access.
  Registry lookup alone does not prove publish permission. Record the SPDX
  identifier and ensure the actual license text ships in the tarball.

- [ ] **Step 2: Complete npm metadata**

  Add version, description, keywords, repository/directory, homepage, bugs,
  author/contributors as appropriate, engines, license, and
  `publishConfig.access: "public"`. Keep `private: true` through this task; Task
  10 owns its removal after required release gates exist.

- [ ] **Step 3: Rewrite onboarding around the packed consumer**

  Include installation, browser prerequisites, five-minute configuration,
  supported versions, trusted-interface warning, artifact ignores, Playwright
  upgrade/rebaseline policy, and troubleshooting.

- [ ] **Step 4: Verify registry and tarball metadata**

  ```bash
  npm whoami
  npm access list packages <npm-scope>
  pnpm --filter <final-package-name> pack:artifact -- \
    /tmp/storybook-addon-visual-tests/metadata.tgz
  pnpm --filter <final-package-name> test:pack -- \
    /tmp/storybook-addon-visual-tests/metadata.tgz
  ```

  Expected: the publishing identity controls the target scope/package, package
  metadata validates, and LICENSE is present in the asserted real archive.

- [ ] **Step 5: Run all package checks**

  ```bash
  pnpm --filter <final-package-name> build
  pnpm --filter <final-package-name> pack:artifact -- \
    /tmp/storybook-addon-visual-tests/release-candidate.tgz
  pnpm --filter <final-package-name> test:exports -- \
    /tmp/storybook-addon-visual-tests/release-candidate.tgz
  pnpm --filter <final-package-name> test:pack -- \
    /tmp/storybook-addon-visual-tests/release-candidate.tgz
  pnpm --filter <final-package-name> test
  pnpm --filter <final-package-name> test:visual
  pnpm --filter <final-package-name> test:consumer -- \
    /tmp/storybook-addon-visual-tests/release-candidate.tgz
  pnpm --filter <final-package-name> typecheck
  pnpm --filter <final-package-name> lint
  pnpm format:check
  ```

  Expected: all pass.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/storybook-addon-visual-tests
  git commit -m "chore(storybook-addon): prepare public preview metadata"
  ```

### Task 10: Add protected trusted publishing

**Files:**

- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/release-storybook-addon-visual-tests.yml`
- Modify: `packages/storybook-addon-visual-tests/package.json`
- Modify: `packages/storybook-addon-visual-tests/README.md`
- Modify: `packages/storybook-addon-visual-tests/docs/configuration.md`
- Modify: `packages/storybook-addon-visual-tests/docs/capture-contract.md`

- [ ] **Step 1: Make package and compatibility gates required in CI**

  For pull requests and canonical-branch pushes, one producer job builds and
  packs an archive once, records its SRI, and uploads it. Every inventory,
  exports, consumer, peer-warning, Node/OS/Storybook/React matrix, and cross-OS
  baseline-transfer job downloads that exact artifact by producing run/job
  identity and verifies the SRI before use. Node, operating system, Storybook,
  and React are the matrix axes; every packed-consumer job must use React-Vite,
  the bundled Chromium build, and direct loopback HTTP as invariant acceptance
  dimensions. These CI artifacts are test inputs only and must never be consumed
  by a privileged publication workflow.

- [ ] **Step 2: Finalize support metadata and remove `private`**

  After the required CI matrix proves the target combinations and cross-OS
  baseline policy, update peer ranges and documentation from target to verified
  support. Remove `private: true`. Rerun package checks and the required CI
  matrix on this final manifest before tagging.

- [ ] **Step 3: Add one protected tag-triggered release workflow**

  Run only for a protected package tag in the canonical repository. In one
  workflow run, verify the dereferenced tag commit and package version, build,
  pack the final archive exactly once, record its npm-compatible SRI, and run
  inventory, exports, consumer smoke, peer checks, the full compatibility
  matrix, and cross-OS baseline transfer against that archive. Every
  packed-consumer matrix job must exercise React-Vite, bundled Chromium, and
  direct loopback HTTP. A dependent publish job in the same run downloads the
  artifact by the producing job's artifact ID, verifies its SRI, requires
  environment approval, and publishes:

  ```bash
  npm publish <tested-artifact>.tgz --tag next --provenance
  ```

  Do not use `workflow_run`, accept an artifact from a pull-request run, rebuild,
  repack, or publish the package directory.

- [ ] **Step 4: Enforce workflow security**

  Set default `permissions: {}` or `contents: read`; grant `id-token: write`
  only to the publish job. Pin third-party actions to full commit SHAs, use
  pinned Node/npm versions that support trusted publishing, require protected
  package tags and the canonical repository owner, bind the artifact to the
  dereferenced tag SHA and successful producing jobs in the same workflow run,
  and ensure no `NPM_TOKEN` or equivalent long-lived registry credential is
  present.

- [ ] **Step 5: Validate workflow syntax and security**

  ```bash
  actionlint
  zizmor .github/workflows/
  ```

  Expected: no errors; any accepted warning is documented with a precise reason.

- [ ] **Step 6: Verify the release candidate locally**

  ```bash
  pnpm --filter <final-package-name> pack:artifact -- \
    /tmp/storybook-addon-visual-tests/workflow-candidate.tgz
  pnpm --filter <final-package-name> test:pack -- \
    /tmp/storybook-addon-visual-tests/workflow-candidate.tgz
  pnpm --filter <final-package-name> test:exports -- \
    /tmp/storybook-addon-visual-tests/workflow-candidate.tgz
  pnpm --filter <final-package-name> test:consumer -- \
    /tmp/storybook-addon-visual-tests/workflow-candidate.tgz
  git diff --exit-code
  ```

  Expected: controlled archive, green isolated consumer, clean generated state.

- [ ] **Step 7: Commit**

  ```bash
  git add .github/workflows/ci.yml \
    .github/workflows/release-storybook-addon-visual-tests.yml \
    packages/storybook-addon-visual-tests/package.json \
    packages/storybook-addon-visual-tests/README.md \
    packages/storybook-addon-visual-tests/docs
  git commit -m "ci(storybook-addon): add trusted preview publishing"
  ```

### Task 11: Publish and verify a prerelease

**Files:**

- Modify only version/release-note files required by the chosen release process.

- [ ] **Step 1: Cut a prerelease version**

  Use `0.1.0-next.0` or the equivalent agreed prerelease. Do not assign `latest`.

- [ ] **Step 2: Trigger the protected release workflow**

  Verify the workflow publishes the exact CI-tested `.tgz` with `--tag next`
  and provenance. It must not rebuild or repack.

- [ ] **Step 3: Install from the registry in a fresh fixture**

  Repeat the consumer smoke using `<package>@0.1.0-next.0`, not the local
  tarball. Also create a separate fresh npm-managed verification fixture with a
  `package-lock.json` using the pinned npm CLI.

- [ ] **Step 4: Verify dist-tag, integrity, metadata, and provenance**

  ```bash
  npm view <final-package-name>@0.1.0-next.0
  npm view <final-package-name>@0.1.0-next.0 dist.integrity
  npm dist-tag ls <final-package-name>
  npm --prefix /tmp/storybook-addon-npm-verification audit signatures
  ```

  Expected: `next` points to the prerelease; `latest` is absent or unchanged;
  registry integrity exactly equals the recorded npm-compatible SRI of the
  tested artifact;
  metadata is correct; the pinned npm CLI verifies registry signatures and
  provenance. Installed export behavior is proven by Step 3, not `npm view`.

- [ ] **Step 5: Collect external installation feedback**

  Promote to `0.1.0` only after at least one clean project outside llame
  completes installation, capture, approval, and rerun.

## Chunk 5: Optional repository extraction

### Task 12: Extract only when independent maintenance is justified

**Files:**

- Create in the extracted repository: standalone `package.json`, pnpm workspace
  configuration if retained, lockfile, TypeScript/build/lint/test configuration,
  CI/release workflows, contribution/security files, and repository metadata.
- Modify package-relative scripts only where monorepo root tooling was previously
  inherited.

- [ ] **Step 1: Decide whether extraction has measurable value**

  Require a concrete independent lifecycle: separate maintainers, issue
  tracking, release cadence, or contributor audience. npm publication alone is
  not sufficient justification.

- [ ] **Step 2: Produce the candidate history**

  Prefer `git subtree split`; use `git filter-repo` when precise history
  filtering is required. Do not use deprecated `git filter-branch`.

- [ ] **Step 3: Scaffold the standalone repository**

  Generate and commit a standalone lockfile and every root configuration the
  package previously inherited. Do not claim the subtree alone is installable.

- [ ] **Step 4: Run release gates in the extracted checkout**

  ```bash
  pnpm install --frozen-lockfile
  pnpm run build
  pnpm run pack:artifact -- \
    /tmp/storybook-addon-visual-tests/extracted-candidate.tgz
  pnpm run test:exports -- \
    /tmp/storybook-addon-visual-tests/extracted-candidate.tgz
  pnpm run test:pack -- \
    /tmp/storybook-addon-visual-tests/extracted-candidate.tgz
  pnpm run test
  pnpm run test:visual
  pnpm run test:consumer -- \
    /tmp/storybook-addon-visual-tests/extracted-candidate.tgz
  pnpm run typecheck
  pnpm run lint
  pnpm run format:check
  ```

  Expected: the extracted repository passes without llame workspaces, catalogs,
  scripts, or aliases.

- [ ] **Step 5: Move publication authority deliberately**

  Update repository metadata, trusted-publisher configuration, tags, issue
  routing, and security reporting before the extracted repository becomes
  authoritative.

## Deferred feature backlog

These features are valuable only after the public package boundary is proven:

1. read-only CI runner and machine-readable output;
2. named viewport modes;
3. theme/global variants;
4. component/directory sidebar-scoped runs;
5. required-resource failure contracts;
6. capture phase selection;
7. deterministic masking/ignored regions;
8. Firefox and WebKit.

Each requires a separate design because it expands baseline identity, review
semantics, or execution topology. None belongs in the initial preview release.

## Revision history

- **v1 (2026-07-24):** Initial package-local public preview plan after the
  release-readiness sweep and executable-plan review.
- **v2 (2026-07-24):** Fixed round-1 refinement findings: corrected focused test
  commands; added preset-option validation, testing-widget run-all coverage, and
  cross-OS baseline-transfer evidence; assigned final `private` removal; replaced
  unsafe cross-workflow artifact reuse with a single protected tag workflow; and
  added an npm-lockfile signature-verification fixture.
- **v3 (2026-07-24):** Fixed round-2 refinement findings: added testing-widget
  run-all to the packed consumer; specified complete runtime option validation;
  made one-OS support the deterministic portability fallback; separated the
  local transfer-harness negative control from real cross-OS CI evidence; and
  required one CI producer artifact with SRI verification in every matrix job.
- **v4 (2026-07-25):** Addressed PR review feedback by separating strict runtime
  branding checks from temporarily workspace-scoped fixtures and making
  React-Vite, bundled Chromium, and direct loopback HTTP mandatory invariants in
  every packed-consumer compatibility job.

## Final release gate

Do not publish the preview unless all of the following are true:

- runtime identifiers are generic;
- the support and trust contract is explicit;
- manager payload types match serialized payloads;
- package unit, visual, type, and lint checks pass;
- the compiled tarball contains only allowlisted files;
- a temporary non-workspace project installs and exercises that tarball;
- the exact inspected and consumer-tested `.tgz` is the workflow artifact that
  publication consumes, with matching recorded and registry SRI;
- the Node/Storybook/React/OS support matrix passes without unexpected peer
  warnings, with every job exercising React-Vite, bundled Chromium, and direct
  loopback HTTP;
- exact baseline bytes approved on every claimed OS pass when transferred to
  every other claimed OS, or the environment identity/support contract is
  narrowed before release;
- the testing-widget run-all path completes correctly over multiple stories;
- roots confinement, stale approval, cancellation, and capture-origin failures
  have consumer-visible negative coverage;
- public metadata and a license grant ship in the tarball;
- publication uses least-privilege, SHA-pinned, protected trusted publishing
  without a long-lived npm token;
- the prerelease is published under `next`, while `latest` remains absent or
  unchanged;
- the registry artifact passes a post-publication smoke test.
