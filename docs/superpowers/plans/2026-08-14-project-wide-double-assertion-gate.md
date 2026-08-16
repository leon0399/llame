# Project-Wide Double-Assertion Removal Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents are available) or superpowers:executing-plans to implement this
> plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every `as unknown as` assertion from owned `.ts`, `.tsx`,
`.mts`, and `.cts` files, then make issue #268's prohibition a native full-tree
check. The current staged API script is transitional regression protection, not
completion.

**Architecture:** Migrate the 113 legacy matches in coherent boundary-owned stack
layers. Prefer real framework and SDK types, narrow consumer contracts, and runtime
validation at untrusted boundaries. Once the inventory is zero, configure ast-grep
with TypeScript and TSX rules and invoke its native `scan` command directly from
Lefthook and CI. Delete the bespoke Git-diff parser and its custom shell harness.

**Tech Stack:** TypeScript, Vitest, provider/framework test utilities, ast-grep
0.44.x, Lefthook, GitHub Actions, pnpm.

---

## Chunk 1: Preserve a reproducible baseline

### Task 1: Record the owned-code inventory

**Files:**

- Modify: `docs/code-quality-tracker.md`

- [ ] **Step 1: Count matches on the recorded `master` commit**

Run:

```bash
git grep -n -E 'as[[:space:]]+unknown[[:space:]]+as' 8bca868e -- \
  '*.ts' '*.tsx' '*.mts' '*.cts'
```

Expected at `8bca868e`: 113 matched lines across 46 files.

- [ ] **Step 2: Group by real boundary**

Record migration slices by ownership and remedy, such as AI SDK models, provider
tool callbacks, Nest test modules, database fixtures, HTTP mocks, and UI fixtures.
Do not split by arbitrary line count.

## Chunk 2: Remove the legacy debt

### Task 2: Migrate each boundary slice

For every slice:

- [ ] Add or preserve a focused behavioral test before changing the fixture or
      boundary type.
- [ ] Replace double assertions with the standard library/framework/SDK test
      utility when one exists.
- [ ] Otherwise narrow the consumer to the capability it uses, construct a
      complete typed value, or validate an untrusted boundary at runtime.
- [ ] Do not replace the construct with `as any`, a non-null assertion, an
      over-broad interface, or an allowlist entry.
- [ ] Run the focused test, affected workspace lint/typecheck, Prettier, and
      `git diff --check`.
- [ ] Update the tracker with the remaining count and the stack PR.

Continue until this command returns no output:

```bash
rg -n --glob '*.{ts,tsx,mts,cts}' 'as\s+unknown\s+as' .
```

Issue #268 cannot close before the result is empty.

## Chunk 3: Install native full-tree enforcement

### Task 3: Configure ast-grep rules

**Files:**

- Create: `sgconfig.yml`
- Create: `rules/no-double-assertion-through-unknown-ts.yml`
- Create: `rules/no-double-assertion-through-unknown-tsx.yml`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] Pin `@ast-grep/cli@0.44.0` at the workspace root.
- [ ] Define equivalent native rules for TypeScript and TSX that match an
      assertion through `unknown` and report an error for `.ts`, `.tsx`, `.mts`,
      and `.cts` files.
- [ ] Validate the rule using ast-grep's native `test` command only if fixture
      coverage is needed; do not build a custom shell test runner.
- [ ] Add the exact root script
      `"check:double-assertions": "ast-grep scan --error ."`.
- [ ] Use the native scan against temporary violating `.ts`, `.tsx`, `.mts`, and
      `.cts` files, including root/e2e paths, to prove every supported extension
      is RED; remove the fixtures, then prove the owned tree is GREEN. Do not add
      a repository-specific harness.

### Task 4: Use the same native command locally and in CI

**Files:**

- Modify: `lefthook.yml`
- Modify: `.github/workflows/lint.yml`
- Delete: `scripts/check-new-unknown-as-casts.sh`
- Delete: `scripts/check-new-unknown-as-casts.test.sh`
- Modify: `AGENTS.md`
- Modify: `apps/api/AGENTS.md`
- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`

- [ ] Replace the staged API script with `pnpm check:double-assertions`.
- [ ] Run that same package script in the existing lint workflow so the pinned
      local binary is on `PATH`; no direct binary call, diff base, or
      grandfathered baseline is allowed.
- [ ] Document the project-wide ban and retain the API-specific Nest narrowing
      recipe without implying the rule is API-only.
- [ ] Mark the tracker layer done only after the owned-tree scan is green.

## Chunk 4: Verify, review, and stack

### Task 5: Verify the completed prohibition

Run fresh:

```bash
pnpm check:double-assertions
pnpm lint
pnpm typecheck
pnpm format:check
actionlint
pinact run --check
git diff --check
```

Expected: every command exits 0 and the inventory command prints nothing.
Dispatch specification and code-quality review, repair confirmed findings, rebase
up-stack, and publish the layers sequentially. PR descriptions must not contain a
`Test plan` section. Do not close #268 until CI confirms the full-tree rule.
