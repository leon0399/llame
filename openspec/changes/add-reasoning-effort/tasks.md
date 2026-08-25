# Tasks — per-request reasoning effort

## Stack layout

One task group per stacked branch, bottom first. Each layer is one PR based on
the layer below, so a reviewer sees only that layer's diff.

```text
(master) <- effort/deps <- effort/proposal <- effort/config <- effort/execution <- effort/disclosure <- effort/finalize
              #583          #584             group 1-2        group 3-4           group 5             group 6
              landed        this PR
```

| Layer               | Group | Ships                                                       |
| ------------------- | ----- | ----------------------------------------------------------- |
| `effort/deps`       | —     | AI SDK v6 bump (#583, landed) — prerequisite for `max`      |
| `effort/proposal`   | —     | This change's artifacts (#584)                              |
| `effort/config`     | 1–2   | Catalog declares an effort vocabulary; the API publishes it |
| `effort/execution`  | 3–4   | Accept, validate, persist, and send effort for a chat run   |
| `effort/disclosure` | 5     | Inheritance, telemetry, receipt, and events                 |
| `effort/finalize`   | 6     | CHANGELOG, full verification, `/opsx:sync`, `/opsx:archive` |

Create each layer with `gh stack add <branch>` from the layer below, and open
them with `gh stack submit --auto --open`.

**Merge the stack as a unit** — `gh stack merge <top PR> --yes` merges that PR
and every unmerged PR beneath it, all-or-nothing. This matters here:
`effort/execution` sends effort to the provider while `effort/disclosure` is
what records it everywhere `modelId` is recorded, so merging the execution
layer alone would put master in a state that violates the
"effort accompanies model identity" requirement until the next merge.

## 1. Model catalog declares an effort vocabulary — `effort/config`

- [x] 1.1 Add the `reasoning` object to `$defs.modelEntry` in
      `apps/api/src/instance-config/llame.config.schema.json` (`effortLevels`:
      non-empty string array, `uniqueItems`, items `minLength: 1` and **no
      `pattern`**; `defaultEffort`: non-empty string, required alongside
      `effortLevels`; `cacheInvalidatedByEffortChange`: boolean) and **remove**
      the `reasoning` boolean; verify a config setting `reasoning: true` fails
      `assertValidRaw` naming the model, and one setting a valid object passes.
- [x] 1.2 Replace `reasoning?: boolean` with the object type on `RawModelEntry`
      (`instance-config/llame-config.ts`) and `PublicModelCatalogEntry`
      (`models/model-catalog.ts`); verify `pnpm --filter api build` typechecks
      and that `toPublicModel` still passes the object through without listing
      it.
- [x] 1.3 Add cross-field boot validation in `config-loader.ts`:
      `defaultEffort` must be a member of the same entry's `effortLevels`;
      verify unit tests cover a valid entry, a non-member default, a missing
      default with levels present, an empty level list, a duplicate level, and a
      blank level — each failure naming the model id.
- [x] 1.4 Confirm no level is normalized, lowercased, sorted, deduplicated, or
      pattern-checked on load; verify a test asserts that an operator-authored
      order, a mixed-case token, and a token containing `-` or `_` all survive
      round-trip through `InstanceConfigService` byte-identically.

## 2. Publish the contract — `effort/config`

- [x] 2.1 Update `AvailableModelResponse.reasoning` in
      `apps/api/src/models/dto` to the object with Swagger metadata, describing
      `effortLevels` as ordered opaque identifiers rather than display strings;
      verify `GET /api/v1/models` returns the object for a declaring model and
      omits the key entirely for a non-declaring one (no `null`, no empty
      object).
- [x] 2.2 Regenerate `apps/api/openapi.json` (`pnpm --filter api build`) and the
      committed Orval bindings (`pnpm --filter web api:generate` or the
      equivalent script); verify
      `apps/web/lib/api/generated/models/availableModelResponse.ts` carries the
      object and `pnpm --filter web build` passes.
- [x] 2.3 Update `apps/api/llame.config.json.example` and the operator
      documentation that shows a `models[]` entry; verify `pnpm lint:markdown`
      passes and the example config boots.
- [x] 2.4 Record this layer's breaking config change in `CHANGELOG.md` — the
      repo rule is that the PR shipping the work carries the entry, and an
      operator whose config still sets `reasoning: true` cannot start; verify
      `pnpm lint:markdown` passes.
- [x] 2.5 Layer gate: run
      `pnpm exec turbo run build --filter=api --concurrency=1`,
      `pnpm --filter api lint`, `pnpm --filter api test`, and
      `pnpm --filter web build`; verify all pass before opening the
      `effort/config` PR.

## 3. Accept and persist the resolved effort — `effort/execution`

- [x] 3.1 Add a nullable `effort` text column to `runs` in
      `apps/api/src/db/schema/chats.ts` and generate the migration with
      `drizzle-kit`; verify `pnpm db:generate` reports no further schema drift
      and the migration applies to a database with existing runs, leaving them
      NULL.
- [x] 3.2 Accept an optional `effort` on `CreateMessageDto`
      (`chats/dto/chats.dto.ts`) as a nonblank string, using `ValidateIf` rather
      than `IsOptional` so an explicit `null` is rejected; verify DTO tests
      cover absent, valid, blank, `null`, and non-string.
- [x] 3.3 Resolve `request.effort ?? model.reasoning?.defaultEffort` in the send
      path **after** model resolution and before the user message and run are
      created, rejecting a non-member level or any effort on a non-reasoning
      model with 422 `effort_not_available`; verify controller tests assert no
      message and no run exist after each rejection, including an effort valid
      for a _different_ catalog model and one differing only by letter case.
- [x] 3.4 Ensure an unavailable or missing `modelId` short-circuits before
      effort is evaluated; verify a test posting both an unavailable model and
      an invalid effort receives `model_not_available` only.
- [x] 3.5 Write the resolved value through `RunsRepository.create`; verify an
      integration test shows the concrete level persisted (not a default
      marker), and that editing `defaultEffort` afterwards leaves the stored row
      unchanged.

## 4. Send it to the provider — `effort/execution`

- [x] 4.1 Add `effort?: string` to `ModelStreamInput`
      (`models/model-client.ts`) documented as a provider-neutral opaque token;
      verify the type builds and no existing caller is forced to pass it.
- [x] 4.2 Map it in `openai-model-client.ts` onto
      `providerOptions.openai.reasoningEffort`, merged with the existing native
      `reasoningSummary` option rather than replacing it, on both the Responses
      and `openai.chat()` paths; verify tests using the injected `streamText`
      seam assert the option reaches `streamOptions` on each path and that
      `reasoningSummary` survives.
- [x] 4.3 Gate the mapping on `effort !== undefined`, never on truthiness;
      verify a test asserts a level denoting disabled reasoning is still sent.
- [x] 4.4 Pass the run's persisted effort from `RunExecutionService` into
      `client.streamText` without re-reading or re-validating configuration;
      verify worker tests cover a run executing at its stored level after the
      model's `defaultEffort` changed, a run whose stored level was withdrawn
      from `effortLevels` still sending that level, and a run with NULL effort
      sending no option at all.
- [x] 4.5 Assert effort is absent from `model_context_snapshots`; verify an
      integration test shows two runs differing only in effort binding the
      **same** snapshot row.
- [x] 4.6 Assert no context item is authored for an effort change; verify a
      test covers effort-changed/model-unchanged (no item) and
      effort-changed/model-changed (the model-change item only, with no mention
      of effort), and that `EFFECTIVE_CONTEXT_CHANGE_CAUSES` is unchanged.
- [x] 4.7 Assert reasoning collection is independent of the declaration and of
      the level; verify a test shows normalized reasoning chunks persisted for a
      run at a disabling level and for a model with no `reasoning` object.
- [x] 4.8 Layer gate: run
      `pnpm exec turbo run build --filter=api --concurrency=1`,
      `pnpm --filter api lint`, `pnpm --filter api test`, and
      `pnpm --filter api test:integration`; verify all pass before opening the
      `effort/execution` PR.

## 5. Inheritance, telemetry, and disclosure — `effort/disclosure`

- [ ] 5.1 Thread the triggering run's effort into `CompactionService`'s full
      compaction path and the **source** run's effort into
      `compactForTransition`; verify tests assert the inherited value on each
      path, that a source run's effort is used rather than the incoming turn's
      on a model switch, that a withdrawn level is still sent, and that a run
      with no effort produces a compaction call with none.
- [ ] 5.2 Confirm `TitleService` passes no effort on either the
      `generateObject` or `streamText` path; verify a test asserts the absence
      for a triggering run that carried one.
- [ ] 5.3 Add optional `effort` to `TurnTelemetry` and
      `BuildTurnTelemetryInput` (`chats/turn-telemetry.ts`), populate it from
      both the assistant-turn and compaction writers, and include it in the
      structured log payload beside `modelId`; verify tests cover a completed
      turn, an errored turn, an aborted turn, and a compaction — each recording
      the effort it ran with, and omitting the field when there was none.
- [ ] 5.4 Expose `effort` on `RunResponse`, `ContextReceiptResponse`
      (`runs/dto/runs.dto.ts`, sourced from the run as `modelId` already is),
      and `CompactionStatsResponse` (`chats/dto/chats.dto.ts`); verify each
      returns the persisted level and omits it for a pre-migration record.
- [ ] 5.5 Add `effort` to the `model.requested` run event payload
      (`run-execution.service.ts`); verify an event replay test shows it beside
      `modelId`, and that a run without effort emits the event without the
      field.
- [ ] 5.6 Confirm no effort reaches a surface carrying no `modelId`; verify
      tests assert `ActiveRunResponse` and `SharedChatMessageResponse` are
      unchanged.
- [ ] 5.7 Assert recorded effort is never recomputed; verify a test changes a
      model's declared levels and default after a turn and shows the persisted
      usage, receipt, and event values unchanged.
- [ ] 5.8 Regenerate `apps/api/openapi.json` and the Orval bindings for the
      three DTOs changed in 5.4; verify `pnpm --filter web build` passes.
- [ ] 5.9 Layer gate: run
      `pnpm exec turbo run build --filter=api --concurrency=1`,
      `pnpm --filter api lint`, `pnpm --filter api test`, and
      `pnpm --filter api test:integration`; verify all pass before opening the
      `effort/disclosure` PR.

## 6. Close out the change — `effort/finalize`

One PR, no production code. Runs after every implementation layer above is
complete and green.

- [ ] 6.1 Extend the `CHANGELOG.md` entry — the breaking
      `models[].reasoning` shape change is recorded by the layer that ships it,
      so add the new per-request `effort` and the compaction inheritance rule
      alongside it rather than writing a fresh entry; verify
      `pnpm lint:markdown` passes.
- [ ] 6.2 Check off every task in groups 1–5 and re-run
      `openspec validate add-reasoning-effort --strict`; verify it reports the
      change as valid.
- [ ] 6.3 Full verification sweep across the whole stack, sequentially:
      `pnpm exec turbo run build --filter=api --concurrency=1`,
      `pnpm --filter web build`, `pnpm --filter api lint`,
      `pnpm --filter api test`, `pnpm --filter api test:integration`, and
      `pnpm lint:markdown`; verify all pass.
- [ ] 6.4 Run `/opsx:sync add-reasoning-effort` to fold the three delta specs
      into `openspec/specs/{instance-config,available-models,reasoning-output}/spec.md`;
      verify each main spec carries the new and modified requirements and that
      no `## ADDED`/`## MODIFIED` delta headers leak into a main spec.
- [ ] 6.5 Run `/opsx:archive add-reasoning-effort` in the same PR; verify the
      change moves under `openspec/changes/archive/` and `openspec list --json`
      no longer reports it as active. Archive warns about incomplete tasks — its
      own group is necessarily unchecked while it runs, so confirm past that
      warning only after 6.1–6.4 are done.
- [ ] 6.6 Verify the closure PR contains **only** documentation and spec
      movement: no `apps/` or `packages/` changes in its diff.
