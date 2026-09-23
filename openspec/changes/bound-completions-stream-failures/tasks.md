## Delivery

One branch and one PR, by Leo's named exception (2026-09-23) to the
proposal / implementation / finalize stack:

```text
master <- issue-908
```

The branch carries three commit groups in order, each behind its own gate:

- Proposal (sections 1): this ledger, the proposal, the design, and the two
  delta specs. Exit: the OpenSpec proposal, Product Markdown, and Any change
  verification rows, one adversarial review round committed separately, and
  Leo's approval of the reviewed local revision. Implementation starts only
  after that approval.
- Implementation (section 2): the client change, its tests, the run-level
  test, the Go runbook paragraph, and the changelog entry. Exit: the Workspace
  TypeScript, Product Markdown, and Any change rows locally.
- Finalize (section 3): canonical spec synchronization, task records, and
  archive movement only, never an application fix. Exit: the Final OpenSpec,
  Product Markdown, and Any change rows.

Estimated authored size about 800 lines against `master` (tests, specs, and
docs included; archive movement measured with rename detection; no generated
output). Re-measure before publication and request an exception if it exceeds
the review budget. The PR closes #908. It is published as a draft only after
archive movement; self-review (SR) of its actual diff precedes draft -> ready,
and the GitHub review (GR) and CI loop follow per CONTRIBUTING.md. Both are
post-archive gates, not tasks below. Merge requires Leo's explicit permission.

`$gh-stack` is not used: there is no stack. `$openspec-apply-change` drives
section 2 and `$openspec-sync-specs` / `$openspec-archive-change` section 3.

## 1. Proposal

- [x] 1.1 Run one adversarial review round with two independent reviewers over the proposal, design, and both delta specs; verify every finding against the repository and the installed adapters' built source; commit the revision separately from the initial draft; record the round in the design's revision history.
- [x] 1.2 Verify the `opencode-go-provider` MODIFIED block reproduces master's requirement and all four of its scenarios, differing only in the intended failure-contract text and the one added scenario, by a programmatic diff of scenario names and bullets against `openspec/specs/opencode-go-provider/spec.md`. Recorded: master 4 scenarios, delta 5, 0 missing, 0 changed, 1 added (`An unreadable stream event from the gateway is not quoted`).
- [x] 1.3 Prove the proposal rows: `pnpm exec openspec validate bound-completions-stream-failures --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass.
- [ ] 1.4 Obtain Leo's approval of the reviewed revision; record the approved commit here.

## 2. Implementation

- [ ] 2.1 In `apps/api/src/models/openai-completions-model-client.test.ts`, add failing tests over the real client and adapter with a stubbed `fetch`, one per `provider-api-selection` scenario: an unreadable non-JSON event and a schema-mismatched event each report the identical bounded error whose message and stack contain no canary from the event and which has no `cause`; an event with `choices` and a string `error`, and one with `choices` and a message-less `error` object, report that same bounded error; an in-stream envelope reports an `Error` whose message is the envelope's message and carries no other envelope field; a 302 reaching a redirect-refusing transport, and a 503 followed on retry by a 302, each report the redirect error naming 302 and not the `Location`; a `fetch` rejecting with a `TypeError` reports the SDK's transport message unchanged; a request with no caller `onError` hands the bounded error, not the parse error, to `console.error`. Verify each bounding test fails on the current client for the stated reason.
- [ ] 2.2 Implement design D2-D5 in `apps/api/src/models/openai-completions-model-client.ts`: one mapping function over the reported error, installed as the streaming request's `onError` and forwarding to the caller's handler or to `console.error`. Verify the tests from 2.1 pass and the existing completions tests still pass (`pnpm --filter api exec vitest run src/models/openai-completions-model-client.test.ts`).
- [ ] 2.3 In `apps/api/src/models/opencode-go-model-client.test.ts`, invert the test that pins the quoted event so it asserts the bounded message and the absence of the event canary, and extend the redirect test to assert the refused-redirect message names 302 and not the `Location`. Verify the Go test file passes, and that the envelope, 429, and 502 tests pass unchanged.
- [ ] 2.4 In `apps/api/src/runs/run-execution.service.test.ts`, add a run-level test that passes the real completions client over a stubbed `fetch` to `executeRun`: for an unreadable event and for an in-stream envelope, the persisted error, the terminal run event's payload, and the `Logger.error` arguments carry the bounded text or the envelope's message respectively, no event canary, and never `[object Object]`. Verify it fails with the client change reverted and passes with it.
- [ ] 2.5 Update the failure paragraph of `docs/opencode-go.md` to state the fixed texts' contract instead of the quoted parse error, and add a dated `CHANGELOG.md` entry naming #908. Verify `pnpm lint:markdown` and `pnpm format:check` pass.
- [ ] 2.6 Prove the implementation rows: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the three focused test files, `pnpm format:check`, and `git diff --check` pass.

## 3. Finalize

- [ ] 3.1 Run `$openspec-sync-specs` for this change; verify `openspec/specs/provider-api-selection/spec.md` gains the requirement and `openspec/specs/opencode-go-provider/spec.md` carries the modified requirement with every scenario, and that no other canonical spec changed.
- [ ] 3.2 Verify archive readiness: `openspec status --change bound-completions-stream-failures --json` reports every artifact done, every task in sections 1 and 2 plus 3.1 is checked, and `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass.
