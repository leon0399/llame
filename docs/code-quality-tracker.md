# Code Quality Taser Tracker

Living tracker for the constraints and refactors that make low-quality generated
code fail early. This is not a claim that automation creates good code. It records
which failure modes are measured, which gates exist, and where judgment is still
required.

**Baseline:** `master` at `8bca868e`, measured 2026-08-14.

**States:** `done` shipped; `active` current stack ownership; `queued` evidence-backed;
`investigate` measurement needed before implementation.

## Active stack

| Order | State       | Layer                                   | Acceptance evidence                                                                                                |
| ----: | ----------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
|     1 | active      | Tracker and design baseline             | Documents match live configuration, issue #268, and measured debt                                                  |
|     2 | queued      | Web test doubles                        | Web reaches zero matches using Vitest, Storybook, and native Web API types; full web and browser suites pass       |
|     3 | queued      | Complexity ceiling and first extraction | Oxlint rejects modified complexity over 35; the current 53-point function must be reduced below the ceiling        |
|     4 | queued      | AI SDK model doubles                    | `model-client.test.ts` and the shared fake use typed SDK test utilities; focused tests/typecheck pass              |
|     5 | queued      | Remaining cast slices                   | All 113 legacy owned-code matches reach zero; no baselines or allowlists remain                                    |
|     6 | queued      | Full-tree double-assertion prohibition  | One native ast-grep package script rejects `.ts`, `.tsx`, `.mts`, and `.cts` across the owned tree in hooks and CI |
|     7 | queued      | Semantic Markdown and lint ratchets     | Chosen standard tool rejects invalid owned Markdown without broad disables                                         |
|     8 | queued      | Mutation-testing pilot                  | Bounded Stryker run completes; runtime and every survivor category recorded                                        |
|     9 | investigate | Modular/service refactors               | Only measured coupling or responsibility hotspots become layers                                                    |

## Inventory

### Typing and assertions

| State       | Finding                                                                                                             | Evidence / exit condition                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| done        | API convention bans `as unknown as T` and gives the `Pick<>` plus explicit Nest injection-token recipe              | `apps/api/AGENTS.md`; PR #285                                                               |
| done        | New staged API `.ts` casts are blocked while migration debt remains                                                 | Existing interim script and Lefthook job; this is regression protection, not acceptance     |
| queued      | The ban is not project-wide                                                                                         | Lefthook covers only `apps/api/**/*.ts`; root, e2e, web TSX, MTS, and CTS remain outside it |
| queued      | TSX needs its own ast-grep parser                                                                                   | `--lang ts` returns no match for JSX containing a double assertion; `--lang tsx` finds it   |
| queued      | 118 matched text lines, 113 across 46 owned application/test files                                                  | Exit condition is zero matches in all tracked TS/TSX/MTS/CTS; no grandfathered baseline     |
| queued      | Largest file cluster is `apps/api/src/models/model-client.test.ts` with 13                                          | Migrate the AI SDK boundary with `ai/test` instead of narrowing a Nest dependency           |
| queued      | Other top clusters: OpenAI tools 9; app setup 8; chat-loop integration 7; search worker and chats controller 6 each | Group by boundary and remedy; do not chase count mechanically                               |
| investigate | Direct `any`, non-null assertions, and stale ESLint disables                                                        | Classify production vs test/integration scaffolding before enabling restriction rules       |

### Lint and formatting

| State  | Finding                                                                                    | Evidence / exit condition                                                                                     |
| ------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| done   | Prettier checks all owned repository files, including Markdown/MDX, JSON(C), YAML, and CSS | Root `format:check`, `.prettierignore`, lint workflow, staged hook                                            |
| done   | Oxlint runs with warnings denied in API, web, UI, and Storybook                            | Workspace `lint` scripts and Turbo                                                                            |
| queued | API is type-aware; other workspaces are substantially lighter                              | Compare the four `.oxlintrc.json` files; enable supported rule families only after violation review           |
| queued | Semantic Markdown is not linted                                                            | Select a maintained Node-22-compatible linter; define explicit owned/ignored paths; prove bad fixture failure |
| queued | Unused lint-disable directives are not rejected                                            | Evaluate Oxlint's `--report-unused-disable-directives` repo-wide before enabling                              |
| queued | Four Vitest rules are disabled in API                                                      | Ratchet one rule per slice and repair findings, as already required by `docs/testing.md`                      |

### Complexity and structure

| State       | Finding                                                                                               | Evidence / exit condition                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| queued      | Modified complexity over 20: API 12, web 3, UI 1                                                      | Re-run Oxlint's `complexity` rule from the baseline config                      |
| queued      | Worst measured function: `chat-loop.service.ts` callback at 53                                        | Characterize, extract cohesive stages, set global ceiling to 35                 |
| queued      | Next API values above 30: MCP client callback 34, prompt assertion 32                                 | Separate PR slices; lower ceiling only after each is repaired                   |
| queued      | Files over 1,000 lines include production services/repositories and large test suites                 | File length is triage only; split by responsibility, not arbitrary line count   |
| investigate | `run-execution.service.ts`, `mcp-server-client.ts`, and `chats-repository.ts` are production hotspots | Map responsibilities and dependency fan-in before proposing interfaces/modules  |
| investigate | Web `chat-page.tsx` and conversation tree are large UI orchestrators                                  | Require render/interaction evidence and consult `DESIGN.md` before any UI split |

### Test quality

| State  | Finding                                                                                          | Evidence / exit condition                                                          |
| ------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| done   | Unit, real-Postgres integration, Storybook browser, and product E2E are separate enforced layers | `docs/testing.md`, CI workflow                                                     |
| queued | No mutation-testing command or configuration exists                                              | Bounded `apps/api` pilot only; no broad CI gate initially                          |
| queued | First pilot candidate: three pure MCP utilities with direct unit tests                           | Dry run, then full mutation run; record time, score, survivors, equivalent mutants |
| queued | `apps/api/README.md` names a nonexistent `test:cov` script                                       | Remove or restore intentionally; do not leave executable docs false                |
| queued | Source-regex tests and disabled Vitest rules remain known follow-ups                             | Existing `docs/testing.md` list; convert when owning files are touched             |

### Conventions and governance

| State  | Finding                                                                                | Evidence / exit condition                                                                |
| ------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| active | Keep this tracker current in every quality stack layer                                 | Layer changes state and adds PR/evidence before submission                               |
| queued | Root convention must distinguish capability interfaces from interface ceremony         | State the four valid boundary reasons and reject one-interface-per-service cargo culting |
| queued | Complexity exceptions need local rationale and owner                                   | No directory-wide exemption; temporary exception names issue and measured value          |
| queued | Gate runtime budgets are unrecorded                                                    | Record local and CI duration before making mutation or expensive analysis blocking       |
| queued | Quality work must update `CHANGELOG.md`; roadmap entries are removed only when shipped | Follow root documentation contract in implementation layers                              |

### Documentation, specification, and ownership drift

| State  | Finding                                                                                                            | Evidence / exit condition                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| queued | Runtime floor contradicts itself                                                                                   | Root `AGENTS.md` and `package.json` require Node 22.19+, `.node-version` pins 22.23.1, while `docs/runtime-and-package-manager.md` and a workspace comment still name 22.12 |
| queued | Root migration rule says never hand-write SQL while API instructions require security-critical reviewed exceptions | Reword root rule to generate by default and link the documented exception ledger; retain explicit verification requirements                                                 |
| queued | `docs/testing.md` says unit tests are cached while Turbo and CI intentionally disable test caching                 | Make cached-versus-fresh execution claims match `turbo.json` and CI                                                                                                         |
| queued | Root formatting command description understates the owned surface                                                  | Document the actual ignore-pruned repository-wide Prettier command rather than only TS/TSX/Markdown                                                                         |
| queued | `SPEC.md` links an archived OpenSpec change as if it were active authority                                         | Retarget canonical behavior to `openspec/specs` and provenance to the archive; add link validation                                                                          |
| queued | OpenSpec project rules and strict CI validation are absent                                                         | Define project context/rules, measure current validation failures, then add an authoritative check                                                                          |
| queued | API and security-sensitive paths have no CODEOWNER                                                                 | Assign explicit owners for backend, migrations, auth/security configuration, and workflows                                                                                  |
| queued | Story provenance and documentation conventions are advisory only                                                   | Add an AST/static metadata guard with an explicit exception manifest                                                                                                        |
| queued | Root claims every workspace has child instructions, but `packages/config-typescript` has none                      | Add a focused guide or qualify the root statement                                                                                                                           |

### Workflow and supply-chain checks

| State  | Finding                                                                          | Evidence / exit condition                                                                                                                       |
| ------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| done   | Workflow syntax and action-pin validation are shipped and green on the baseline  | Workflow-lint CI owns both gates; `actionlint` and `pinact run --check` re-run locally on 2026-08-14                                            |
| queued | Pedantic workflow security reports seven findings, concentrated in `git-ai.yaml` | Review broad write permission, installer provenance, concurrency, job naming, and reusable-workflow permissions; rerun actionlint/zizmor/pinact |
| queued | The local double-assertion hook is bypassable and absent from CI                 | Reach zero debt, then run native ast-grep full-tree enforcement in hooks and CI; delete the bespoke diff script (#287)                          |

## Rejected shortcuts

- Enable every Oxlint category and suppress the fallout.
- Set complexity just above the current maximum and call it enforcement.
- Generate an interface for every service without a second implementation or narrow
  consumer boundary.
- Add mutation testing to the full monorepo or browser suite before a measured pilot.
- Convert all 113 cast lines in one unreviewable PR; use coherent boundary slices,
  but finish every slice before closing #268.
- Keep a diff-scoped gate, baseline, or allowlist as the finished state.
- Build repository-specific parsers or rule-test harnesses when a maintained tool
  provides native configuration and execution.
- Treat Prettier as semantic Markdown linting.
