# Code Quality Taser Tracker

Living tracker for the constraints and refactors that make low-quality generated
code fail early. This is not a claim that automation creates good code. It records
which failure modes are measured, which gates exist, and where judgment is still
required.

**Baseline:** `master` at `8bca868e`, measured 2026-08-14.

**States:** `done` shipped; `ready` complete locally and awaiting submission;
`active` current stack ownership; `queued` evidence-backed; `investigate`
measurement needed before implementation.

## Active stack

| Order | State       | Layer                                   | Acceptance evidence                                                                                                         |
| ----: | ----------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
|     1 | active      | Tracker and design baseline             | Documents match live configuration, issue #268, and measured debt                                                           |
|     2 | active      | Web test doubles                        | Web has zero matches using Vitest, Storybook, and native Web API types; 340 unit and 300 browser tests pass                 |
|     3 | active      | Complexity ceiling and first extraction | Four native Oxlint configs enforce modified complexity 35; the 53-point function measures 30 after a boundary extraction    |
|     4 | active      | AI SDK model doubles                    | 14 assertions removed; focused units 11/11, compaction integration 17/17, and API typecheck/lint pass                       |
|     5 | active      | Remaining cast slices                   | Standard SDK/framework types and real database transactions remove all 80 assertions across owned application and test code |
|     6 | active      | Full-tree double-assertion prohibition  | One pinned native ast-grep package script rejects `.ts`, `.tsx`, `.mts`, and `.cts` across the owned tree in hooks and CI   |
|     7 | active      | Constructor decorator placement (#286)  | All 46 `@Inject` constructor parameters use split placement; native ast-grep rejects inline regressions                     |
|     8 | active      | Semantic Markdown and lint ratchets     | Pinned markdownlint-cli2 scans 200 product-owned files with zero findings through the same local/CI command                 |
|     9 | active      | Unused lint-disable ratchet             | Native Oxlint enforcement removed 48 stale directives and reports zero across all four lint-owning workspaces               |
|    10 | active      | Contributor documentation contracts     | Runtime, migration, formatting, and test-cache claims match their executable configuration                                  |
|    11 | active      | Shared TypeScript config ownership      | The final workspace has focused instructions naming preset fan-out, boundaries, and sequential consumer verification        |
|    12 | active      | Mutation-testing pilot                  | PR #390 carries the native config/baseline; PR #391 repairs tool-ID gaps; 82 useful gaps remain in layers 2–4               |
|    13 | investigate | Modular/service refactors               | Only measured coupling or responsibility hotspots become layers                                                             |

## Published PR stack

Publication here means the PR exists in the remote stack; it does not mean the
layer is merged or shipped. Layer state remains active until merge.

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
|    25 | #384 | Full-tree double-assertion gate     |
|    26 | #385 | Constructor decorator placement     |
|    27 | #386 | Semantic Markdown lint              |
|    28 | #387 | Unused lint-disable ratchet         |
|    29 | #388 | Contributor documentation contracts |
|    30 | #389 | Shared TypeScript config ownership  |
|    31 | #390 | Bounded mutation-testing pilot      |
|    32 | #391 | MCP tool-ID mutation repairs        |

## Current submission

| State     | Layer                                   | Commit evidence                                                                                                                   | PR   |
| --------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---- |
| submitted | MCP tool-ID mutation repair child layer | `170d217a` adds three behavior assertions and records the 90-mutant 86.67% result plus exact evidence for all 12 runner artifacts | #391 |

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
| investigate | Direct `any` and non-null assertions                                                                     | Classify production vs test/integration scaffolding before enabling restriction rules                                                     |

### Lint and formatting

| State  | Finding                                                                                    | Evidence / exit condition                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| done   | Prettier checks all owned repository files, including Markdown/MDX, JSON(C), YAML, and CSS | Root `format:check`, `.prettierignore`, lint workflow, staged hook                                                           |
| done   | Oxlint runs with warnings denied in API, web, UI, and Storybook                            | Workspace `lint` scripts and Turbo                                                                                           |
| queued | API is type-aware; other workspaces are substantially lighter                              | Compare the four `.oxlintrc.json` files; enable supported rule families only after violation review                          |
| active | Semantic Markdown is linted across 200 product-owned files                                 | Pinned markdownlint-cli2 0.23.2 reports zero findings; only upstream/generated integrations and symlink aliases are excluded |
| active | Unused lint-disable directives are rejected in every lint-owning workspace                 | Native Oxlint enforcement removed 48 stale directives; API, web, UI, and Storybook each report zero                          |
| queued | Four Vitest rules are disabled in API                                                      | Ratchet one rule per slice and repair findings, as already required by `docs/testing.md`                                     |
| active | Constructor parameter decorator placement is standardized (#286): 46 split, zero inline    | Native ast-grep scopes enforcement to `@Inject` constructor parameters; no wrapper, diff parser, or custom harness           |

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

| State       | Finding                                                                                          | Evidence / exit condition                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| done        | Unit, real-Postgres integration, Storybook browser, and product E2E are separate enforced layers | `docs/testing.md`, CI workflow                                                                                                                                                                                                                                                                                                                                                              |
| done        | Bounded mutation-testing command and configuration                                               | `apps/api/stryker.config.json` limits mutation to three pure MCP utilities, uses pinned `@stryker-mutator/vitest-runner@9.6.1`, keeps Stryker and Vitest at one worker, and emits native reports; no broad CI gate initially                                                                                                                                                                |
| active      | First pilot candidate: three pure MCP utilities with direct unit tests                           | PR #390: 33 tests and 425 mutants; the 2026-08-15 baseline is 69.41% with 101 survivors, 29 no-coverage mutants, and 6 timeouts; disposition inventory follows below                                                                                                                                                                                                                        |
| active      | Child layer 1: tool-id canonicalization/parser                                                   | PR #391: three behavior assertions cover invalid-format parsing, edge trimming, and the exact 64-character boundary; six baseline `U` gaps are repaired and 12 baseline survivors are reclassified `R` with exact manual evidence                                                                                                                                                           |
| queued      | Child layer 2: protected-values normalization/propagation                                        | 24 useful `U` mutants remain queued for normalization, ordering/ties, scalar detection, and nested failure propagation; no gaps marked repaired                                                                                                                                                                                                                                             |
| queued      | Child layer 3: bounded-fetch request parsing/body sizing/response byte-limit semantics           | Exactly 42 useful `U` mutants remain queued: `S7`, `S10`, `S12`, `S16`, `S17`, `S33`, `NC37`, `NC38`, `S39`, `NC51`, `NC52`, `NC53`, `NC54`, `NC55`, `NC56`, `NC57`, `NC58`, `NC59`, `S41`, `S42`, `S43`, `S45`, `S47`, `S48`, `S49`, `S50`, `S65`, `S66`, `S68`, `S70`, `S71`, `S73`, `S79`, `S81`, `S89`, `S101`, `S102`, `S103`, `S106`, `S109`, `S111`, `S123`; no gaps marked repaired |
| queued      | Child layer 4: bounded-fetch SSE recognition/framing plus wrapper cancellation/metadata          | Exactly 16 useful `U` mutants remain queued: `S85`, `S113`, `S136`, `S137`, `S139`, `S140`, `S146`, `S149`, `S151`, `S153`, `S163`, `S164`, `S165`, `S166`, `S167`, `S168`; no gaps marked repaired                                                                                                                                                                                         |
| done        | API README command inventory                                                                     | The workspace README lists executable commands only; it does not document a nonexistent coverage script or invent coverage tooling                                                                                                                                                                                                                                                          |
| queued      | Source-regex tests and disabled Vitest rules remain known follow-ups                             | Existing `docs/testing.md` list; convert when owning files are touched                                                                                                                                                                                                                                                                                                                      |
| investigate | The committed OpenAPI contract has no generated property-based conformance run                   | Pilot Schemathesis against the throwaway API/Postgres environment; measure auth and tenant setup, status/schema findings, replayability, runtime, and false positives before gating                                                                                                                                                                                                         |
| investigate | The chat-message single-flight integration test flakes only under suite load                     | Timed out on PR #361 and locally in the full 329-test run; isolated rerun passes 1/1; diagnose scheduling/state coupling before changing timeouts                                                                                                                                                                                                                                           |
| investigate | Product E2E auth navigation and session fixtures flake under concurrent Next dev load            | PR #361 rerun flaked in two auth cases; PR #367 hit `ERR_ABORTED`; logs show Next `ECONNRESET`/aborts; diagnose server lifecycle rather than adding retries or timeouts                                                                                                                                                                                                                     |

#### Mutation-testing pilot baseline (2026-08-15)

The bounded baseline used the committed `apps/api/stryker.config.json`: three pure MCP
utilities, their three direct Vitest files, the native Vitest runner, and
`concurrency: 1`. The native report is `apps/api/reports/mutation/mutation.json`
(ignored generated output). The mutation counts, scores, per-file totals, and
survivor inventory below are native JSON report facts. Runtime, memory, and failure
observations are identified separately as foreground command output. The committed
thresholds are high 80%, low 60%, with no break threshold.

| Provenance                                      | Metric               | Result                                                                                                                                                                                                                                        |
| ----------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator-observed foreground Vitest/time output | Command              | `/usr/bin/time -v pnpm --filter api test:mutation`                                                                                                                                                                                            |
| Operator-observed foreground Vitest/time output | Exit status          | 0                                                                                                                                                                                                                                             |
| Operator-observed foreground Vitest/time output | Test scope           | 3 files, 33 tests; the direct Vitest preflight also passed 33/33                                                                                                                                                                              |
| Native JSON report fact                         | Mutation scope       | 3 source files, 425 instrumented mutants                                                                                                                                                                                                      |
| Native JSON report fact                         | Outcomes             | 289 killed; 101 survived; 29 no coverage; 6 timeout; 0 compile errors; 0 ignored; 0 pending                                                                                                                                                   |
| Native JSON report fact                         | Mutation score       | 69.41% (covered-mutant rate 74.49%)                                                                                                                                                                                                           |
| Operator-observed foreground Vitest/time output | Wall time            | 2:30.62                                                                                                                                                                                                                                       |
| Operator-observed foreground Vitest/time output | Maximum resident set | 250388 kB; 0 swaps                                                                                                                                                                                                                            |
| Operator-observed foreground Vitest/time output | Dry-run reference    | 4.23 s, 279432 kB maximum resident set, 33 tests, 425 mutants                                                                                                                                                                                 |
| Operator-observed foreground Vitest/time output | Memory preflight     | 6.6 GiB available and 34 MiB swap used before the direct tests; 6.7 GiB available and 35 MiB swap used afterward                                                                                                                              |
| Committed config / installed runner             | Process budget       | Stryker `concurrency: 1`; the package/lockfile pin plus installed `@stryker-mutator/vitest-runner@9.6.1` source force `maxThreads`, `maxWorkers`, and `maxConcurrency` to 1; any upgrade must reverify these options and peak-memory evidence |

Operator-observed foreground Stryker/time output recorded one network-disabled invocation
that failed before Stryker started because its logging server attempted to bind
`0.0.0.0` and received `EPERM`; the one authorized network-enabled retry above is
the only mutation result. No configuration, source, test change, or custom log
artifact was made to obtain it.

| Source file            |   Total |  Killed | Survived | No coverage | Timeout | Mutation score |
| ---------------------- | ------: | ------: | -------: | ----------: | ------: | -------------: |
| `mcp-bounded-fetch.ts` |     169 |      97 |       59 |          13 |       0 |         57.40% |
| `protected-values.ts`  |     166 |     120 |       28 |          12 |       6 |         75.90% |
| `tool-id.ts`           |      90 |      72 |       14 |           4 |       0 |         80.00% |
| **All files**          | **425** | **289** |  **101** |      **29** |   **6** |     **69.41%** |

The native JSON report contains 130 survivor/no-coverage entries. `S` means survived and
`NC` means no coverage; the number is the native Stryker mutant ID. `U` is a useful
behavior gap to repair with a focused test, `E` is a likely equivalent mutant for
the supported input domain, `I` is an intentionally untested implementation detail
outside the current contract, and `R` is a narrowly evidenced runner/static-mutant
activation artifact disproven by applying the exact replacement. `R` is not a test
gap, equivalent mutant, ignored mutant, or waiver. Grouped rows retain every ID and
its file:line/mutator location. S170 is the only current `R`.

The disposition count is 100 useful behavior gaps, 20 likely equivalent mutants,
9 intentionally untested implementation details, and 1 runner/static-mutant
activation artifact.

The native JSON reports six Stryker `Timeout` statuses for mutants 230, 231, 259, 261,
262, and 265. Operator-observed manual code interpretation identifies these as
mutation-induced nontermination in the `redactProtectedString` cursor loop; that
interpretation is not native JSON evidence. They are timeout statuses, not repair
backlog entries.

##### `src/mcp/mcp-bounded-fetch.ts`

| Native IDs                   | File:line (mutator)                                               | Disposition | Evidence-backed reading / next evidence                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1, S2, S4, S5               | 3, 4, 10, 11 (`StringLiteral`)                                    | I           | Error message and `name` spellings are observable labels, but no current contract pins them; keep them out of the first repair slice.                      |
| S7                           | 29 (`MethodExpression`)                                           | U           | `httpMethod` is exposed to `onBytes`; add uppercase normalization and `Request` fallback assertions.                                                       |
| S10                          | 30 (`StringLiteral`)                                              | U           | The default `GET` context is untested when the request is a URL or has no method; assert the context.                                                      |
| S12, S16                     | 32 (`ConditionalExpression`, `BlockStatement`)                    | U           | Non-string request bodies must produce a null RPC method without changing the HTTP context; add a typed-body case.                                         |
| S17                          | 33 (`ObjectLiteral`)                                              | U           | Non-string request bodies must produce a null RPC method without changing the HTTP context; add a typed-body case.                                         |
| NC29, NC30                   | 37, 38 (`BlockStatement`, `ObjectLiteral`)                        | E           | JSON arrays, primitives, and `null` cannot carry a JSON `method` property; the alternate non-object guard still yields `rpcMethod: null`.                  |
| S20, S21, S22, S23, S24, S26 | 37 (`ConditionalExpression`, `LogicalOperator`)                   | E           | The parser's non-object alternatives are observationally equivalent for JSON values; only a non-JSON object with custom properties could distinguish them. |
| S33                          | 43 (`ConditionalExpression`)                                      | U           | A JSON object with a non-string `method` must remain `null`; add number, boolean, and object method cases.                                                 |
| NC37, NC38                   | 45, 46 (`BlockStatement`, `ObjectLiteral`)                        | U           | Invalid JSON request bodies must not throw or invent an RPC method; add a malformed-body context case.                                                     |
| S39                          | 52 (`BlockStatement`)                                             | U           | Removing request-size calculation defeats the request budget for supported bodies; add a small-body and no-limit control case.                             |
| NC51, NC52, NC53             | 56 (`ConditionalExpression`, `BlockStatement`)                    | U           | `URLSearchParams` sizing is an explicit `BodyInit` branch and is not covered; add exact and over-limit byte cases.                                         |
| NC54, NC55                   | 59 (`ConditionalExpression`)                                      | U           | `ArrayBuffer` request sizing is untested; add an exact and over-limit case.                                                                                |
| NC56, NC57                   | 60 (`ConditionalExpression`)                                      | U           | Typed-array request sizing is untested; add an exact and over-limit case.                                                                                  |
| NC58, NC59                   | 61 (`ConditionalExpression`)                                      | U           | `Blob` request sizing is untested; add an exact and over-limit case.                                                                                       |
| S41, S42, S43, S45           | 53 (`ConditionalExpression`, `LogicalOperator`)                   | U           | `undefined`/`null` must count as zero bytes when a request limit exists; add no-body and null-body cases.                                                  |
| S47, S48, S49, S50           | 54 (`ConditionalExpression`, `EqualityOperator`, `StringLiteral`) | U           | String byte sizing and UTF-8 behavior need a small-body boundary assertion independent of the existing oversized request.                                  |
| S65, S66                     | 76 (`LogicalOperator`, `ConditionalExpression`)                   | U           | The limit guard must not reject bounded bodies incorrectly or enforce a missing limit; add below-limit and omitted-limit cases.                            |
| S68, S70, S71, S73           | 77 (`ConditionalExpression`, `EqualityOperator`)                  | U           | Unsupported bodies and the exact byte boundary are untested; add `undefined` size and exactly-at-limit cases.                                              |
| S79, S81                     | 86 (`ConditionalExpression`, `OptionalChaining`)                  | U           | An absent session ID must not call an optional callback, and an absent callback must not throw when a session exists.                                      |
| S85                          | 90 (`MethodExpression`)                                           | U           | `text/event-stream; charset=utf-8` must be recognized; add a parameterized content-type case.                                                              |
| S89                          | 93 (`StringLiteral`)                                              | U           | Treating every content type as an event stream changes byte accounting; add a successful non-SSE response with a content type.                             |
| S99                          | 97 (`ConditionalExpression`)                                      | E           | When the header is absent, the following anchored numeric regex still rejects `null`; replacing the null check is observationally redundant.               |
| S101, S102, S103             | 98 (`Regex`)                                                      | U           | Numeric-prefix, numeric-suffix, and one-digit content-length mutations accept malformed claims; add malformed-header cases.                                |
| S106                         | 99 (`EqualityOperator`)                                           | U           | A claimed response exactly at the limit should be allowed; add the exact-boundary case.                                                                    |
| S109                         | 101 (`OptionalChaining`)                                          | U           | A claimed oversized response may have a null body; preserve the custom limit error rather than dereferencing `null`.                                       |
| S111                         | 104 (`ConditionalExpression`)                                     | U           | Bodyless responses must be returned unchanged; add a null-body response case.                                                                              |
| S113                         | 110 (`BooleanLiteral`)                                            | U           | An event stream beginning with an LF has a distinct blank-line boundary; add an LF-only framing case.                                                      |
| S123                         | 116 (`EqualityOperator`)                                          | U           | A non-SSE body exactly at the response limit should not fail; add the exact-size case.                                                                     |
| S136                         | 127 (`BlockStatement`)                                            | U           | Bare-CR line delimiters are not covered; add a CR-only SSE framing case.                                                                                   |
| S137, S139                   | 128 (`ConditionalExpression`, `EqualityOperator`)                 | U           | CR blank-line versus nonblank-line event resets need a multi-line event that exceeds the per-event budget.                                                 |
| S140                         | 130 (`BooleanLiteral`)                                            | U           | Initial CR state affects a leading LF boundary; add a stream beginning with an empty LF line.                                                              |
| S146                         | 132 (`ConditionalExpression`)                                     | U           | Processing LF after CR would reset every CRLF line instead of only blank lines; add a multi-line CRLF event.                                               |
| S149, S151                   | 133 (`ConditionalExpression`, `EqualityOperator`)                 | U           | LF blank-line detection needs nonblank and blank lines in the same event; add both boundary forms.                                                         |
| S153                         | 137 (`BlockStatement`)                                            | U           | Ordinary SSE bytes must advance line state; add a multi-line event with ordinary data.                                                                     |
| S155                         | 139 (`AssignmentOperator`)                                        | E           | Only zero versus nonzero `lineBytes` is observed, so incrementing or decrementing remains equivalent after a nonempty byte.                                |
| S163                         | 159 (`ArrowFunction`)                                             | U           | Explicit cancellation of the returned bounded body must cancel the upstream reader; add a direct consumer-cancel assertion.                                |
| S164                         | 161 (`ObjectLiteral`)                                             | U           | The wrapper must preserve response status, status text, and headers; add metadata assertions.                                                              |
| S165, S166, S167, S168       | 166-169 (`ObjectLiteral`)                                         | U           | `redirected`, `type`, and `url` are fetch response metadata; add a transparent-wrapper metadata case.                                                      |

##### `src/mcp/protected-values.ts`

| Native IDs                                                    | File:line (mutator)                                                                         | Disposition | Evidence-backed reading / next evidence                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NC196, NC197, NC198, NC199, NC200, NC201, NC202, NC203, NC204 | 22 (`ConditionalExpression`, `EqualityOperator`, `UnaryOperator`)                           | U           | Equal-length protected values are absent; add a tie case that independently asserts deterministic lexical ordering.                                                                                                                                                                     |
| S169                                                          | 1 (`StringLiteral`)                                                                         | U           | Tests import the redaction marker for their expected value, so the marker mutation can escape; assert the literal redaction contract independently.                                                                                                                                     |
| S170                                                          | 7 (`ArrowFunction`)                                                                         | R           | Operator-observed manual mutation evidence, not a native JSON fact: applying the exact replacement `() => undefined` made three existing `protected-values.test.ts` behaviors fail (recursive object redaction, protected-key fail-closed, direct argument detection); source restored. |
| S171, S173, S174, S175, S176, S178                            | 8 (`ConditionalExpression`, `LogicalOperator`)                                              | E           | The record predicate is reached only after all supported JSON kinds have been handled; alternate predicates are equivalent on that domain.                                                                                                                                              |
| S183                                                          | 18 (`MethodExpression`)                                                                     | U           | Dropping sorting weakens longest-first replacement and deterministic normalization; add reversed overlapping and equal-length inputs.                                                                                                                                                   |
| S191, S192, S193, S194, S195                                  | 19-21 (`BlockStatement`, `ArithmeticOperator`, `ConditionalExpression`, `EqualityOperator`) | U           | The comparator's ordering and tie behavior need direct assertions; current setup coverage does not independently kill these mutations.                                                                                                                                                  |
| S220, S221                                                    | 40 (`LogicalOperator`, `ConditionalExpression`)                                             | E           | Non-finite numbers are outside canonical JSON scalar handling; finite JSON numbers take the same branch.                                                                                                                                                                                |
| S228, S232                                                    | 58, 60 (`EqualityOperator`, `StringLiteral`)                                                | E           | With normalized nonempty protected values, the extra terminal loop and initial empty match do not change output.                                                                                                                                                                        |
| S250, S252, S253, S255                                        | 68 (`ConditionalExpression`, `EqualityOperator`)                                            | U           | Longest-match tie breaking is security-relevant when callers provide overlapping values; add an unsorted-overlap case.                                                                                                                                                                  |
| S275                                                          | 113 (`ConditionalExpression`)                                                               | U           | Direct numeric, boolean, and null protected-value detection is not independently covered; add scalar containment cases.                                                                                                                                                                 |
| S280                                                          | 116 (`MethodExpression`)                                                                    | U           | Array detection must be existential, not universal; add a mixed safe/protected array case.                                                                                                                                                                                              |
| NC285, S284                                                   | 121 (`BooleanLiteral`, `ConditionalExpression`)                                             | I           | Unknown non-record inputs are outside the JSON-like contract; retain the fail-closed implementation without a first-slice test.                                                                                                                                                         |
| S313                                                          | 173 (`ConditionalExpression`)                                                               | U           | A nested protected object key inside an array must propagate failure instead of being retained; add the nested-array case.                                                                                                                                                              |
| NC319, NC320, S318                                            | 179 (`ObjectLiteral`, `BooleanLiteral`, `ConditionalExpression`)                            | I           | The fallback handles non-JSON unknown values such as `undefined` or functions; those are not current persistence inputs.                                                                                                                                                                |
| S331                                                          | 187 (`ConditionalExpression`)                                                               | U           | Nested object-key failures must propagate without returning a successful payload; add a nested-object case.                                                                                                                                                                             |

##### `src/mcp/tool-id.ts`

| Native IDs                 | File:line (mutator)                                                          | Disposition | Evidence-backed reading / next evidence                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| NC387, NC388, NC389, NC390 | 55-56 (`BlockStatement`, `ObjectLiteral`, `BooleanLiteral`, `StringLiteral`) | U           | A non-`mcp__` input is not tested; add the invalid-format parser case with an independent literal result.                                            |
| S335, S336, S337, S338     | 1 (`Regex`)                                                                  | U           | Anchoring and complete server-ID validation are core canonicalization behavior; add invalid-prefix, invalid-suffix, and multi-character valid cases. |
| S339, S340                 | 2 (`Regex`)                                                                  | U           | Unsafe runs must collapse to one underscore and safe runs must remain unchanged; add repeated-separator and mixed-name cases.                        |
| S341, S342, S343, S344     | 3 (`Regex`)                                                                  | U           | Leading and trailing underscore trimming needs independent edge assertions.                                                                          |
| S345, S346                 | 5-6 (`StringLiteral`)                                                        | U           | Prefix and separator literals define the persisted tool-ID format; assert them independently of parser reuse.                                        |
| S374                       | 46 (`EqualityOperator`)                                                      | U           | The 64-character boundary is not tested; add exactly-at-limit and one-over-limit cases.                                                              |
| S385                       | 55 (`ConditionalExpression`)                                                 | U           | Noncanonical parser inputs need a direct invalid-format branch assertion.                                                                            |

#### Child layer 1 repair result (2026-08-15; PR #391 active)

The baseline inventory above is historical and remains unchanged. This child
layer is complete locally but is not merged or shipped. The source file was
temporarily mutated only with the exact native replacements listed above and
restored byte-for-byte (`sha256 e39d27869998b3d3b87fa2faedeb97cdd1bc60074f77533610f1a33a8e2f44b2`).
The three added assertions cover invalid-format parsing for a non-`mcp__` id,
trimming every safe underscore at both tool-name edges while preserving
interior separators, and acceptance of the serialized 64-character boundary;
the existing 65-character rejection remains in place.

- Parser prefix and invalid-format result (`NC387`–`NC390`, `S385`): exact
  NC387 block deletion and exact S385 `false` condition each made the new
  non-`mcp__` assertion fail (`noncanonical` instead of `invalid_format`);
  source restoration returned the direct suite to green. All five are killed;
  the four baseline no-coverage mutants are covered.
- Server-id validation (`S335`–`S338`): exact S335 replacement
  (`/[A-Za-z0-9_-]+$/u`) made the existing invalid-server assertions fail.
  Exact S336 (`/[A-Za-z0-9_-]+/u`) failed two tests: `bad/server` was accepted
  as `mcp__bad/server__search`, and the parser accepted
  `mcp__bad/server__search` instead of returning `invalid_server_id`. Exact
  S337 (`/^[A-Za-z0-9_-]$/u`) and S338 (`/^[^A-Za-z0-9_-]+$/u`) each failed
  10/17 tests: every valid multi-character-server create/parse behavior
  returned `invalid_server_id`, including the expected `empty_tool_name`,
  `overlength`, `noncanonical`, and successful canonical results. Each source
  restoration returned the clean hash; all four native survivors are `R` from
  these exact direct-test failures.
- Unsafe-run collapse (`S339`, `S340`): exact S339 replacement
  (`/[^A-Za-z0-9_-]/gu`) made the existing normalization assertion fail with
  repeated underscores. Exact S340 (`/[A-Za-z0-9_-]+/gu`) failed 9/17 tests:
  the two normalization cases produced `mcp__Web_Server-1__/` and
  `"mcp__web__  _..._///_  "`, edge trimming returned `empty_tool_name`, `東京`
  was accepted unchanged, overlength/exact-64/canonical-parse cases returned
  `empty_tool_name`, and the parser accepted `mcp__web__東京` while rejecting
  the 55-character case as `empty_tool_name`. Both native survivors are `R`
  from these exact direct-test failures.
- Edge trimming (`S341`–`S344`): exact S341 (`/_+|_+$/gu`) and S343
  (`/^_+|_+/gu`) each failed 4/17 tests: the three create/canonicalization
  cases lost interior underscores (`FindDocs`, `FindDocsNOW`, and `FindDocs`),
  and canonical parsing returned `noncanonical`. Exact S342 (`/^_|_+$/gu`)
  failed the new edge-trim assertion after passing the old suite. Exact S344
  (`/^_+|_$/gu`) failed the new edge-trim assertion with
  `mcp__web__Find__Docs_` (the trailing underscore remained). All four native
  survivors are `R` from these exact direct-test failures.
- Persisted prefix/separator (`S345`, `S346`): exact S345 prefix replacement
  (`''`) made existing generated/parser assertions fail. Exact S346 (`''`)
  failed 10/17 tests: the three normal create cases omitted the `__` separator,
  the 55-character input was accepted instead of `overlength`, the exact-64
  result omitted the separator, canonical parsing failed as `invalid_server_id`,
  and four parser cases returned `invalid_server_id` instead of their expected
  format/canonical/tool-name/length reasons. Both native survivors are `R` from
  these exact direct-test failures.
- Serialized length (`S374`): exact `>=` replacement passed the old suite, then
  failed the new exact-64 assertion; restoration returned 17/17 green. The
  mutant is killed and the 65-character rejection remains covered.

The post-repair direct suite is 17/17. The native one-file run used the
committed Stryker configuration with CLI scope overrides (no temporary config,
wrapper, parser, or custom harness):
`/usr/bin/time -v pnpm --filter api exec stryker run --mutate src/mcp/tool-id.ts --testFiles src/mcp/tool-id.test.ts`.
It measured 90 mutants: 78 killed, 12 survived, 0 no coverage, 0 timeout, and
0 errors; mutation score 86.67% (covered-mutant rate 86.67%), 16.56 seconds
wall time, 223048 kB peak RSS, and 0 swaps. The scoped report renumbered these
survivors `0`–`11`; identical file lines and replacements map them to baseline
`S335`–`S346`. All are `R` based on the exact manual failures above, and no
useful `U` survivor remains in `tool-id.ts`. The literal task command
with `pnpm --filter api test:mutation -- --mutate ...` forwarded an extra
separator and failed before Stryker started, so it was not retried.

The remaining repair slices should target the `U` rows that guard byte limits,
SSE framing, and protected-value propagation. `E` rows should not be
suppressed or changed in Stryker configuration; they remain documented hypotheses
until a supported-input contract changes. `I` rows are deliberately outside the
pilot's first contract and should not be converted into broad robustness tests
without an explicit caller requirement. `R` is evidence-only: retain the exact
replacement and manual failure proof, and never use it as a waiver or ignore bucket.

### Conventions and governance

| State  | Finding                                                                                                      | Evidence / exit condition                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| active | **No-go: trade reviewable delivery for local batching or further polish**                                    | Publish the ready current pilot without waiting for repairs, then submit the four queued child layers independently; do not batch the 100 useful gaps into one local-only repair commit |
| active | **No-go: run resource-unbounded aggregate builds on agent workstations**                                     | Build affected workspaces sequentially; if the aggregate is required, use Turbo `--concurrency=1` and keep it foreground/observable                                                     |
| active | Existing conventions are defaults, not immunity from architectural review                                    | Replace a convention when evidence shows material quality, readability, or architecture gains; document and migrate the owned scope, never create a silent one-off divergence           |
| active | Keep this tracker current in every quality stack layer                                                       | Layer changes state and adds PR/evidence before submission                                                                                                                              |
| active | Modified cyclomatic complexity must stay at `<= 35` and refactors must follow real responsibility boundaries | `AGENTS.md`; arbitrary helper extraction, inline disables, and other metric gaming are prohibited; active until remote merge                                                            |
| queued | Root convention must distinguish capability interfaces from interface ceremony                               | State the four valid boundary reasons and reject one-interface-per-service cargo culting                                                                                                |
| queued | Complexity exceptions need local rationale and owner                                                         | No directory-wide exemption; temporary exception names issue and measured value                                                                                                         |
| queued | Gate runtime budgets are unrecorded                                                                          | Record local and CI duration before making mutation or expensive analysis blocking                                                                                                      |
| queued | Quality work must update `CHANGELOG.md`; roadmap entries are removed only when shipped                       | Follow root documentation contract in implementation layers                                                                                                                             |

### Documentation, specification, and ownership drift

| State  | Finding                                                                    | Evidence / exit condition                                                                                                    |
| ------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| active | Runtime floor is consistently documented as Node 22.19+                    | `package.json`, `.npmrc`, `pnpm-workspace.yaml`, and runtime decision doc agree; `.node-version` pins 22.23.1                |
| active | Root migration policy matches the API's reviewed exception ledger          | Drizzle generation remains the default; security/data-transition exceptions require documented regeneration and verification |
| active | Test documentation matches uncached execution                              | `docs/testing.md` now reflects `turbo.json` for unit/Storybook and direct non-Turbo integration/eval/e2e gates               |
| active | Root formatting command documents its real owned surface                   | `pnpm format` is described as ignore-pruned repository-wide Prettier with cache, matching `package.json`                     |
| queued | `SPEC.md` links an archived OpenSpec change as if it were active authority | Retarget canonical behavior to `openspec/specs` and provenance to the archive; add link validation                           |
| queued | OpenSpec project rules and strict CI validation are absent                 | Define project context/rules, measure current validation failures, then add an authoritative check                           |
| queued | API and security-sensitive paths have no CODEOWNER                         | Assign explicit owners for backend, migrations, auth/security configuration, and workflows                                   |
| queued | Story provenance and documentation conventions are advisory only           | Add an AST/static metadata guard with an explicit exception manifest                                                         |
| active | Every workspace has focused child instructions                             | `packages/config-typescript/AGENTS.md` names preset consumers, config-only boundaries, and sequential verification           |

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
| active | Structural ast-grep enforcement is full-tree and shared by local/CI gates        | `pnpm lint:ast-grep` owns double assertions and API decorator placement through native rules; no bespoke wrapper remains (#287, #286)           |
| active | Semantic Markdown enforcement is shared by local/CI gates                        | `pnpm lint:markdown` owns the explicit product-documentation scope with zero baseline, inline disable, or custom wrapper                        |
| active | Native Oxlint rejects unused disable directives in all four workspaces           | Existing Turbo, Lefthook, and CI lint paths share the workspace commands; 48 stale directives removed with no baseline                          |

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
