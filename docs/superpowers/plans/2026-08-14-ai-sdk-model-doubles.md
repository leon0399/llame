# AI SDK Model Doubles Implementation Plan

**Goal:** Remove the `as unknown as` cluster from the OpenAI model-client unit
tests and the shared fake model client by using Vitest's partial-mock typing and
AI SDK v6 test models, without changing production model selection or stream
semantics.

**Boundary:** `apps/api/src/models/model-client.test.ts`,
`apps/api/src/models/fake-model-client.ts`, and the focused
`apps/api/src/models/fake-model-client.test.ts`. Do not change the
`ModelClient` production contract or add dependency-injection seams solely for
tests.

**Status:** The implementation evidence is complete in the current stack. Layer
4 remains `active` until remote merge; layer 5 is queued with 80 remaining
application/test cast lines.

## Task 1: Preserve the behavioral contract

- Move the two fake-client behavior tests out of `model-client.test.ts` into
  `fake-model-client.test.ts`, so they run with the real `ai` module rather than
  the `streamText` module mock used by the OpenAI-client tests.
- Preserve coverage that callbacks fire on consumption, empty/unconsumed
  streams remain lazy, responses cycle, and text/full-stream surfaces agree.
- Add the async `onFinish` regression before repairing the SDK-backed fake's
  completion semantics. It first went RED because the SDK's `.text` promise
  could resolve before an async `onFinish` callback settled. The fix is a
  completion barrier: the fake wraps the SDK result in a `Proxy`, intercepts
  `.text`, and waits for both the SDK text promise and the callback completion
  promise.

Verification:

```bash
pnpm --filter api exec vitest run --project unit \
  src/models/model-client.test.ts src/models/fake-model-client.test.ts
```

Result: 2 files, 11/11 tests passed.

## Task 2: Replace the OpenAI provider casts

- Import `MockLanguageModelV3` from `ai/test` for provider-model values.
- Type `createOpenAI` and `streamText` with
  `vi.mocked(..., { partial: true })`.
- Build the callable provider double with `Object.assign(vi.fn(...), {
  chat: vi.fn(...),
})`; the partial return contract accepts only the capabilities exercised by
  `createOpenAIModelClient`.
- Return an empty partial stream result in tests that never consume it.
- Remove all 13 `as unknown as` assertions from `model-client.test.ts`; do not
  replace them with `any`, single assertions, or a full fake implementation of
  every `OpenAIProvider` method.

## Task 3: Rebuild the shared fake on the real SDK stream surface

- Import `simulateReadableStream` and `streamText` from `ai`, and
  `MockLanguageModelV3` from `ai/test`.
- Type provider chunks as `LanguageModelV3StreamPart` from `@ai-sdk/provider`.
- Build each response with real `streamText` and the typed SDK chunks, while
  forwarding the existing model input fields and preserving the simplified
  `onTextDelta`/`onFinish` behavior.
- Keep the Proxy completion barrier from Task 1. The SDK result handles stream
  consumption; the Proxy only makes `.text` await the async callback lifecycle.
- Remove the hand-built `ReturnType<typeof streamText>` object and its one
  double assertion. Keep response cycling and empty-response behavior unchanged;
  do not turn the fake into a general programmable model framework.

## Task 4: Record, review, and verify the layer

- The targeted slice removes 14 assertions: 13 from
  `model-client.test.ts` and 1 from `fake-model-client.ts`.
- Application/test debt falls from 94 to 80 after the preceding web slice. The
  remaining 80 stay queued under layer 5; the baseline API staged guard remains
  transitional until zero debt enables native full-tree enforcement.
- The focused unit suites pass 11/11.
- The compaction integration evidence is 17/17.
- The full API unit suite passes 78 files / 1090 tests.
- The API build passes.
- API typecheck and API lint pass.
- Layer 4 is `active` until remote merge; layer 5 is `queued` with 80 lines.

Final documentation checks:

```bash
pnpm exec prettier --check CHANGELOG.md docs/code-quality-tracker.md \
  docs/superpowers/plans/2026-08-14-ai-sdk-model-doubles.md
git diff --check
```

No commit or push is part of this documentation update.
