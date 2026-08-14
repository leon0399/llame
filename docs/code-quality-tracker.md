# Code Quality Taser Tracker

Living tracker for the constraints and refactors that make low-quality generated
code fail early. This is not a claim that automation creates good code. It records
which failure modes are measured, which gates exist, and where judgment is still
required.

**Baseline:** `master` at `8bca868e`, measured 2026-08-14.

**States:** `done` shipped; `active` current stack ownership; `queued` evidence-backed;
`investigate` measurement needed before implementation.

## Active stack

| Order | State       | Layer                                   | Acceptance evidence                                                                                                         |
| ----: | ----------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
|     1 | active      | Tracker and design baseline             | Documents match live configuration, issue #268, and measured debt                                                           |
|     2 | active      | Web test doubles                        | Web has zero matches using Vitest, Storybook, and native Web API types; 340 unit and 300 browser tests pass                 |
|     3 | active      | Complexity ceiling and first extraction | Four native Oxlint configs enforce modified complexity 35; the 53-point function measures 30 after a boundary extraction    |
|     4 | active      | AI SDK model doubles                    | 14 assertions removed; focused units 11/11, compaction integration 17/17, and API typecheck/lint pass                       |
|     5 | active      | Remaining cast slices                   | Standard SDK/framework types and real database transactions remove all 80 assertions across owned application and test code |
|     6 | active      | Full-tree double-assertion prohibition  | One pinned native ast-grep package script rejects `.ts`, `.tsx`, `.mts`, and `.cts` across the owned tree in hooks and CI   |
|     7 | investigate | Constructor decorator placement (#286)  | 11 inline vs 35 split `@Inject` parameters measured; select maintained enforcement before one all-split codemod             |
|     8 | queued      | Semantic Markdown and lint ratchets     | Chosen standard tool rejects invalid owned Markdown without broad disables                                                  |
|     9 | queued      | Mutation-testing pilot                  | Bounded Stryker run completes; runtime and every survivor category recorded                                                 |
|    10 | investigate | Modular/service refactors               | Only measured coupling or responsibility hotspots become layers                                                             |

## Published stack

| Order | PR   | Layer                               |
| ----: | ---- | ----------------------------------- |
|     1 | #359 | Tracker and design baseline         |
|     2 | #360 | Web test doubles                    |
|     3 | #361 | Native complexity ceiling           |
|     4 | #362 | AI SDK model doubles                |
|     5 | #363 | AI SDK tool-callback types          |
|     6 | #364 | API HTTP/framework test doubles     |
|     7 | #365 | Chats controller test doubles       |
|     8 | #366 | Chat-loop integration test doubles  |
|     9 | #367 | Search worker test doubles          |
|    10 | #368 | Compaction integration test doubles |
|    11 | #370 | Pins test doubles                   |
|    12 | #371 | Worker AI SDK and abort settlement  |
|    13 | #372 | Remaining AI SDK stream doubles     |
|    14 | #373 | Auth service test doubles           |
|    15 | #374 | Tenant DB service test doubles      |
|    16 | #375 | Session cookie header types         |
|    17 | #376 | Instance config test doubles        |
|    18 | #377 | Tool tenant-context types           |
|    19 | #378 | Source-owned service capabilities   |
|    20 | #379 | Runtime-boundary negative fixtures  |
|    21 | #380 | Worker database/lifecycle fixtures  |
|    22 | #381 | Model-context repository coverage   |
|    23 | #382 | Chats repository query coverage     |
|    24 | #383 | Chat-loop transaction binding       |

## Inventory

### Typing and assertions

| State       | Finding                                                                                                  | Evidence / exit condition                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| done        | API convention bans `as unknown as T` and gives the `Pick<>` plus explicit Nest injection-token recipe   | `apps/api/AGENTS.md`; PR #285                                                                                                             |
| active      | Double assertions are prohibited across the full owned TypeScript tree                                   | Pinned native ast-grep rules scan TS/TSX/MTS/CTS, including hidden owned directories, through one root command in Lefthook and CI         |
| active      | Web test and story doubles contained 19 assertions across 14 files                                       | Zero web matches; 340 web unit tests and 300 Storybook browser tests pass                                                                 |
| active      | `MessagePart` explicitly names `ModelSwitchPart`, `ToolAvailabilityPart`, and `RecencyDigestPart`        | Corrects the pre-existing stored-message type gap without an assertion                                                                    |
| active      | AI SDK model doubles removed 13 assertions from `model-client.test.ts` and 1 from `fake-model-client.ts` | Partial Vitest mocks, `MockLanguageModelV3`, and real `streamText` with typed provider chunks; units 11/11                                |
| active      | OpenAI adapter tool-loop tests removed 9 assertions without OpenAI-specific model doubles                | Provider-boundary `MockLanguageModelV3` drives real SDK scheduling, validation, and repair; focused units 8/8                             |
| active      | API app-setup, auth, models, and runs tests removed 16 assertions                                        | Narrow Nest capabilities, `ExecutionContextHost`, Express `Pick<>`, and `drizzle.mock`; focused units 29/29                               |
| active      | Chats controller tests removed 6 assertions                                                              | Real Node writable streams, typed Vitest spies, Drizzle mock DB, and provider-neutral AI SDK stream result; units 22/22                   |
| active      | Chat-loop integration tests removed 7 assertions                                                         | Existing narrow service contracts and complete built-in config; real-Postgres integration 19/19                                           |
| active      | Search worker tests removed 6 assertions                                                                 | Nest `TestingModule`, public bootstrap lifecycle, provider overrides, and prototype logger spies; units 4/4                               |
| active      | Compaction continuity integration removed 5 assertions                                                   | AI SDK `MockLanguageModelV3`, real `streamText`, typed provider chunks, and public `asSchema`; integration 17/17                          |
| active      | Pins tests removed 4 assertions                                                                          | Nest `TestingModule` provider overrides replace forged concrete service and tenant DB instances; units 11/11                              |
| active      | Worker harness removed 1 forged AI SDK result                                                            | Provider-neutral `MockLanguageModelV3` drives real `streamText`; worker integration 10/10 and model units 15/15                           |
| active      | Shared and worker-mode integration fakes removed 4 forged AI SDK results                                 | One shared provider-neutral `MockLanguageModelV3` client drives real `streamText`; support unit 1/1 and affected integration suites 24/24 |
| active      | Auth service tests removed 3 concrete-class double assertions                                            | Exported `Pick<>` capabilities plus explicit Nest injection tokens preserve mock metadata and runtime DI; units 3/3                       |
| active      | Tenant DB service tests removed 2 forged Drizzle database assertions                                     | Narrow transaction capability, Drizzle's mock driver, and typed Vitest spies replace partial database objects; units 6/6                  |
| active      | HTTP integration support removed 3 `set-cookie` header assertions                                        | Superagent's typed `get('Set-Cookie')` overload and the shared cookie extractor replace direct header-map coercions; integrations 15/15   |
| active      | Instance config consumers removed 2 concrete-service assertions                                          | Existing `InstanceConfigReader`, explicit Nest tokens, and complete built-in config fixtures replace partial config objects; units 15/15  |
| active      | Tool-context units removed 2 concrete tenant-database assertions                                         | Existing `TenantRunner`, Drizzle's mock DB, and a repository spy exercise the real callback boundary; units 23/23                         |
| active      | Remaining service fixtures removed 2 concrete-service assertions                                         | Existing `RunStreamResponder` plus source-owned `ChatReindexDispatcher` capabilities replace concrete bridge/dispatch fixtures            |
| active      | Negative runtime fixtures removed 3 double assertions                                                    | Structural supersets and accurately broad validated inputs replace casts without weakening `User`, registered `Tool`, or `MessagePart`    |
| active      | Database/lifecycle boundaries removed 2 double assertions                                                | Native Drizzle mock replaces an unused forged chain; typed factory client ownership preserves graceful worker teardown                    |
| active      | Model-context repository removed 1 forged database assertion                                             | Real Postgres covers five reachable hash-collision branches; impossible simulated source/availability collisions are deleted              |
| active      | Chats repository removed 1 forged fluent database assertion                                              | Drizzle's native mock and public logger compile real SQL/params; focused units 35/35 and >500-row fork integration 6/6                    |
| active      | Chat-loop transaction binding removed the final forged database assertion                                | 17 orchestration cases use the real `TenantDbService`/Drizzle transaction boundary; 3 pre-transaction guards remain fast units            |
| done        | Zero owned application/test matches remain                                                               | Full-tree inventory reports zero across tracked TS/TSX/MTS/CTS; no grandfathered baseline                                                 |
| active      | Full-tree double-assertion enforcement                                                                   | Pinned native rules include owned hidden directories and run through the same package script in Lefthook/CI; the diff script is deleted   |
| investigate | Direct `any`, non-null assertions, and stale ESLint disables                                             | Classify production vs test/integration scaffolding before enabling restriction rules                                                     |

### Lint and formatting

| State       | Finding                                                                                    | Evidence / exit condition                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| done        | Prettier checks all owned repository files, including Markdown/MDX, JSON(C), YAML, and CSS | Root `format:check`, `.prettierignore`, lint workflow, staged hook                                                 |
| done        | Oxlint runs with warnings denied in API, web, UI, and Storybook                            | Workspace `lint` scripts and Turbo                                                                                 |
| queued      | API is type-aware; other workspaces are substantially lighter                              | Compare the four `.oxlintrc.json` files; enable supported rule families only after violation review                |
| queued      | Semantic Markdown is not linted                                                            | Select a maintained Node-22-compatible linter; define explicit owned/ignored paths; prove bad fixture failure      |
| queued      | Unused lint-disable directives are not rejected                                            | Evaluate Oxlint's `--report-unused-disable-directives` repo-wide before enabling                                   |
| queued      | Four Vitest rules are disabled in API                                                      | Ratchet one rule per slice and repair findings, as already required by `docs/testing.md`                           |
| investigate | Constructor parameter decorator placement drifts (#286): 11 inline, 35 split `@Inject`     | Prefer a maintained formatter/linter rule; codemod and enforcement ship together; no bespoke gate without evidence |

### Complexity and structure

| State       | Finding                                                                                                                      | Evidence / exit condition                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| queued      | Lower-threshold debt remains: modified complexity over 20 is API 12, web 3, UI 1 (unchanged in the 2026-08-14 remeasurement) | Ratchet toward 30 and then 20 remains queued evidence-driven work                                                                               |
| active      | Four lint-owning workspaces enforce modified complexity 35 with Oxlint's native rule                                         | `apps/api/.oxlintrc.json`, `apps/web/.oxlintrc.json`, `packages/ui/.oxlintrc.json`, and `apps/storybook/.oxlintrc.json`; forced lint passes     |
| active      | `chat-loop.service.ts` accepted-turn callback measures 30 after 53 before; private `buildTurnContextAndParts` measures 24    | Context-builder + chat-loop units 83/83; real-Docker chat-loop integration 19/19; forced lint and API typecheck pass; active until remote merge |
| queued      | Next API values above 30: MCP client callback 34, prompt assertion 32                                                        | Lower the ceiling only after each is repaired in a separate evidence-backed slice                                                               |
| queued      | Files over 1,000 lines include production services/repositories and large test suites                                        | File length is triage only; split by responsibility, not arbitrary line count                                                                   |
| investigate | `run-execution.service.ts`, `mcp-server-client.ts`, and `chats-repository.ts` are production hotspots                        | Map responsibilities and dependency fan-in before proposing interfaces/modules                                                                  |
| investigate | Web `chat-page.tsx` and conversation tree are large UI orchestrators                                                         | Require render/interaction evidence and consult `DESIGN.md` before any UI split                                                                 |

### Test quality

| State       | Finding                                                                                          | Evidence / exit condition                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| done        | Unit, real-Postgres integration, Storybook browser, and product E2E are separate enforced layers | `docs/testing.md`, CI workflow                                                                                                                                                      |
| queued      | No mutation-testing command or configuration exists                                              | Bounded `apps/api` pilot only; no broad CI gate initially                                                                                                                           |
| queued      | First pilot candidate: three pure MCP utilities with direct unit tests                           | Dry run, then full mutation run; record time, score, survivors, equivalent mutants                                                                                                  |
| queued      | `apps/api/README.md` names a nonexistent `test:cov` script                                       | Remove or restore intentionally; do not leave executable docs false                                                                                                                 |
| queued      | Source-regex tests and disabled Vitest rules remain known follow-ups                             | Existing `docs/testing.md` list; convert when owning files are touched                                                                                                              |
| investigate | The committed OpenAPI contract has no generated property-based conformance run                   | Pilot Schemathesis against the throwaway API/Postgres environment; measure auth and tenant setup, status/schema findings, replayability, runtime, and false positives before gating |
| investigate | The chat-message single-flight integration test flakes only under suite load                     | Timed out on PR #361 and locally in the full 329-test run; isolated rerun passes 1/1; diagnose scheduling/state coupling before changing timeouts                                   |
| investigate | Product E2E auth navigation and session fixtures flake under concurrent Next dev load            | PR #361 rerun flaked in two auth cases; PR #367 hit `ERR_ABORTED`; logs show Next `ECONNRESET`/aborts; diagnose server lifecycle rather than adding retries or timeouts             |

### Conventions and governance

| State  | Finding                                                                                                      | Evidence / exit condition                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| active | **No-go: trade reviewable delivery for local batching or further polish**                                    | Submit each independently verified layer as a stacked PR before starting the next; local-only commits are inventory, not delivered progress                                   |
| active | **No-go: run resource-unbounded aggregate builds on agent workstations**                                     | Build affected workspaces sequentially; if the aggregate is required, use Turbo `--concurrency=1` and keep it foreground/observable                                           |
| active | Existing conventions are defaults, not immunity from architectural review                                    | Replace a convention when evidence shows material quality, readability, or architecture gains; document and migrate the owned scope, never create a silent one-off divergence |
| active | Keep this tracker current in every quality stack layer                                                       | Layer changes state and adds PR/evidence before submission                                                                                                                    |
| active | Modified cyclomatic complexity must stay at `<= 35` and refactors must follow real responsibility boundaries | `AGENTS.md`; arbitrary helper extraction, inline disables, and other metric gaming are prohibited; active until remote merge                                                  |
| queued | Root convention must distinguish capability interfaces from interface ceremony                               | State the four valid boundary reasons and reject one-interface-per-service cargo culting                                                                                      |
| queued | Complexity exceptions need local rationale and owner                                                         | No directory-wide exemption; temporary exception names issue and measured value                                                                                               |
| queued | Gate runtime budgets are unrecorded                                                                          | Record local and CI duration before making mutation or expensive analysis blocking                                                                                            |
| queued | Quality work must update `CHANGELOG.md`; roadmap entries are removed only when shipped                       | Follow root documentation contract in implementation layers                                                                                                                   |

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

### Generated API and queue contracts

| State       | Finding                                                                                           | Evidence / exit condition                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| queued      | The web app uses a hand-maintained `ky` API client and duplicates backend contract types          | Generate the TypeScript client and types from committed `apps/api/openapi.json` with a maintained OpenAPI generator; prove auth, errors, streaming exceptions, and drift in CI |
| investigate | Queue payloads and operations are code-first `defineQueue<T>` contracts with no AsyncAPI artifact | Inventory every producer, consumer, retry/dead-letter path, and schedule; prove AsyncAPI can be the canonical schema before replacing the existing types                       |
| investigate | AsyncAPI's maintained generators may not model the pg-boss transport adapter                      | Prototype a standard generator/template extension first; custom pg-boss codegen is allowed only for documented unsupported gaps and must have contract fixtures and an owner   |

### Workflow and supply-chain checks

| State  | Finding                                                                          | Evidence / exit condition                                                                                                                       |
| ------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| done   | Workflow syntax and action-pin validation are shipped and green on the baseline  | Workflow-lint CI owns both gates; `actionlint` and `pinact run --check` re-run locally on 2026-08-14                                            |
| queued | Pedantic workflow security reports seven findings, concentrated in `git-ai.yaml` | Review broad write permission, installer provenance, concurrency, job naming, and reusable-workflow permissions; rerun actionlint/zizmor/pinact |
| active | Double-assertion enforcement is full-tree and shared by local/CI gates           | `pnpm check:double-assertions` owns TS/TSX/MTS/CTS through native ast-grep rules; the bespoke diff script is deleted (#287)                     |

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
