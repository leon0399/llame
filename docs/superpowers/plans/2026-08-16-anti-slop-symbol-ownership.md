# Anti-Slop Symbol Ownership Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every symbol name containing `shape` with its actual domain role and enforce `anti-slop/no-shape-in-symbol-names` at zero baseline across all five lint scopes.

**Architecture:** This is a behavior-preserving ownership rename. Prompt-digest test cases name their scenario, the conversation-tree renderer names the node it returns, and MCP result admission names the portable payload contract it checks. The maintained Oxlint rule becomes the shared local, hook, and CI gate after all five existing identifier findings are removed.

**Tech Stack:** TypeScript, React, Vitest, Oxlint, Prettier.

---

## No-go

- Do not replace `shape` with another structural placeholder such as `data`, `object`, `value`, or `thing`; name the scenario, rendered domain object, or admitted payload.
- Do not change prompt output, SVG/React markup, MCP result admission semantics, or exported APIs.
- Do not add an alias for the old identifier, an inline suppression, a baseline, a custom checker, or another lint command.
- Do not broaden this layer into the separate `Reflect.apply` test-contract problem or unrelated naming cleanup.

## Task 1: Prove the current baseline

**Files:**

- Modify: `.oxlintrc.json`
- Modify: `apps/api/.oxlintrc.json`
- Modify: `apps/web/.oxlintrc.json`
- Modify: `apps/storybook/.oxlintrc.json`
- Modify: `packages/ui/.oxlintrc.json`

- [x] Add `"anti-slop/no-shape-in-symbol-names": "error"` beside the four already-enabled anti-slop rules in all five configs.
- [x] Run the five native lint commands and verify RED: exactly five diagnostics in three files—one prompt-test parameter, two conversation-tree references, and two MCP predicate references.

## Task 2: Rename identifiers by domain responsibility

**Files:**

- Modify: `apps/api/src/prompts/chat-default.test.ts`
- Modify: `apps/web/app/(chat)/components/chat-sidebar/chat-sidebar-conversation-tree.tsx`
- Modify: `apps/api/src/mcp/mcp-server-client.ts`

- [x] Rename the prompt test's unused case label from `_shape` to `_scenario`; update its explanatory comment from structural “shapes” to list-presence scenarios.
- [x] Rename `renderNodeShape` to `renderNode`; preserve the returned SVG/React tree byte-for-byte apart from the identifier.
- [x] Rename `hasPortableMcpResultShape` to `hasPortableMcpResultPayload`; preserve its predicate and call site byte-for-byte apart from the identifier.
- [x] Re-run all five lint commands and verify GREEN with the rule enabled.
- [x] Run the prompt and MCP focused API unit suites, API typecheck, and web typecheck.

## Task 3: Record and publish the stack layer

**Files:**

- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-08-16-anti-slop-symbol-ownership.md`

- [x] Mark the rule active at zero findings, reduce the remaining inventory from 1,122 to 1,117, and add the dependent stack layer.
- [x] Record the five domain-role renames in the changelog without claiming merge or release.
- [x] Run root plus four workspace lint, API and web typecheck, focused API tests, `NODE_OPTIONS=--max-old-space-size=2048 pnpm --filter api build`, Markdown lint, targeted Prettier, and `git diff --check` sequentially.
- [x] Obtain independent specification and code-quality review; repair every factual or P0/P1/P2 finding.
- [x] Commit with the required co-author trailer, link above PR #404 with `gh stack link`, open the PR ready for review, and reference issue #268. Do not merge.
- [ ] Require the full remote matrix and zero unresolved review threads before calling the layer ready.
