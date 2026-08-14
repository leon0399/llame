# Quality Taser Design

**Status:** Approved for autonomous execution by the 2026-08-14 overnight mandate.

## Goal

Make pathological AI-generated code fail fast without pretending that tools can
substitute for engineering judgment. The harness must reject objectively risky
constructs, keep existing debt visible, and ratchet toward stronger constraints
without turning routine changes into repository-wide cleanup projects.

The durable progress record is [the quality tracker](../../code-quality-tracker.md).
GitHub issues remain the authority for cross-session status; the tracker records
measurements, sequencing, acceptance evidence, and issue or PR links.

## Strongest counterargument

More rules can make code worse. Agents learn to game metrics: split one readable
function into arbitrary helpers to satisfy complexity, create ceremonial
interfaces around every class to claim SOLID, or add assertions that kill mutants
without testing useful behavior. A maximal rule set would optimize lint output,
not maintainability.

The design therefore treats each gate as a falsifiable intervention. A gate ships
only when its failure mode maps to a concrete defect class, existing violations
are measured, remediation is reviewable, and the runtime cost is known.

## Principles

1. **Measure before enforcing.** Record the baseline and inspect violations before
   choosing a threshold.
2. **Ratchet, do not grandfather silently.** A staged-diff gate may block new debt
   while old debt is migrated, but it must have an exit condition and issue.
3. **Prefer compiler and behavioral evidence.** Formatting and style matter only
   after type, test, security, and boundary correctness.
4. **One stack layer, one concern.** Every PR must be independently reviewable and
   update the tracker with fresh evidence.
5. **No interface ceremony.** Introduce a capability type or interface only where
   it narrows a consumer, isolates an external boundary, enables a real alternate
   implementation, or removes an unsafe test double. Do not wrap every service.
6. **Complexity is a smoke alarm.** A threshold identifies functions requiring
   inspection; extraction must preserve cohesive domain decisions and tests.
7. **Mutation score is diagnostic first.** The pilot is non-blocking until runtime,
   equivalent-mutant noise, and survivor value are measured.
8. **Every exception is local and explained.** Broad file or directory disables
   are debt, not configuration style.

## Baseline

Measured on `master` at `4fa5032b`:

- Prettier already checks the whole owned repository, including Markdown, and the
  staged hook checks parseable Markdown and MDX files. Semantic Markdown linting
  is absent.
- Oxlint runs in every code workspace. API lint is type-aware with unsafe-use
  rules; web, UI, and Storybook have materially lighter configurations.
- `as unknown as` appears on 118 text lines. Five are the gate's own source/config
  examples, leaving 113 debt lines in application or test code. Enforcement is
  limited to staged `apps/api/**/*.ts`, while web TSX contains existing uses.
- Modified-McCabe complexity at 20 reports 12 API functions, three web functions,
  one UI function, and no Storybook configuration functions. The worst measured
  function is an anonymous callback in `chat-loop.service.ts` at 53.
- There is no mutation-testing command or configuration.

Baselines are measurements, not claims that every match is defective.

## Architecture

### Enforcement surface

Keep fast checks in existing workspace scripts and Turbo. Pre-commit hooks provide
immediate feedback, but CI is authoritative because hooks are bypassable. Custom
gates need executable tests or an equivalent red/green fixture before expansion.

### Debt model

Each tracker item has one of four states:

- `done`: shipped with evidence;
- `active`: owned by the current stack;
- `queued`: evidence supports the work but no layer owns it yet;
- `investigate`: hypothesis requires measurement before implementation.

Items are removed only when shipped behavior makes them obsolete; completed work
stays recorded with its PR or commit so later agents do not rediscover it.

### Stack sequence

1. Tracker and design baseline.
2. Project-wide double-assertion prevention, including TSX parser coverage.
3. Complexity ceiling at 35 plus refactoring of the current over-ceiling function;
   ratchet toward 30 and then 20 in later slices based on the measured list.
4. AI SDK model-double migration, eliminating the largest coherent cast cluster.
5. Remaining cast slices grouped by boundary type, not raw count.
6. Semantic Markdown and broader lint rules, introduced one rule family at a time.
7. Workspace-local Stryker/Vitest pilot over a bounded pure-unit target.
8. Evidence-backed service/module refactors found during the earlier slices.

Later layers may be reordered when new evidence changes dependency or risk, but the
tracker must state why.

## Mutation pilot

Use StrykerJS only inside `apps/api`. The first candidate set is the pure MCP unit
surface: `tool-id.ts`, `protected-values.ts`, and `mcp-bounded-fetch.ts`, with only
their direct Vitest unit tests. Start with two workers, clear-text/HTML/JSON reports,
and no breaking score. Inspect survivors manually before choosing a threshold or CI
schedule. Browser mode, integration tests, Docker, and product E2E are excluded.

## Verification

Every layer runs its focused red/green check, workspace lint and typecheck for
affected code, relevant unit or integration tests, Prettier, `git diff --check`,
and any generated-artifact build required by nested `AGENTS.md`. Before submission,
an independent reviewer checks specification compliance and code quality. After
submission, live CI and review threads are re-fetched; failures are repaired in the
owning layer and rebased up-stack.

## Non-goals

- A zero-warning dashboard that hides risk behind suppressions.
- Repository-wide service interfaces.
- A single giant cleanup PR.
- Coverage-percentage targets as a proxy for test quality.
- Blocking CI on an uncalibrated mutation score.
- Refactoring generated, vendored, or unrelated pre-existing code.
