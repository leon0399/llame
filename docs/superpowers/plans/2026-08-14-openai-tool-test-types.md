# OpenAI Tool Test Types Implementation Plan

**Goal:** Remove all nine `as unknown as` assertions from `openai-model-client.tools.test.ts` by exercising the real AI SDK callback types instead of locally inventing narrower callback signatures.

**Boundary:** The tool-loop test file plus tracker/changelog evidence. Production `openai-model-client.ts`, `ModelClient`, and tool behavior remain unchanged unless the SDK types prove an actual production contract defect.

The file is adapter-owned because it verifies `createOpenAIModelClient`; the
test machinery is intentionally not OpenAI-specific. It uses the
provider-neutral `ai`, `ai/test`, and `@ai-sdk/provider` contracts. A shared
fixture module is deferred until a second provider adapter needs the same
fixtures; extracting one for a single consumer would be speculative
indirection.

## Task 1: Preserve the tool-loop behavior

- Run the current focused test and API typecheck baseline.
- Keep the existing assertions for tool-choice forwarding, step-cap behavior, parallel-call counting, the stop-condition backstop, unavailable/invalid tool reporting, JSON parsing, and malformed-input fallback.

## Task 2: Replace partial result and callback assertions with SDK types

- Use `vi.mocked(streamText, { partial: true })` and return an empty partial result; the tests do not consume the result.
- Capture the typed request from the mock call and fail explicitly if the expected optional callback is absent.
- Build a complete `StepResult<ToolSet>` fixture with typed dynamic tool calls. Do not cast a `{ toolCalls }` fragment into the full SDK result.
- Invoke `prepareStep` with the real required fields: `steps`, `stepNumber`, a `MockLanguageModelV3`, `messages`, and `experimental_context`.
- Invoke `experimental_repairToolCall` with the real SDK repair context: `system`, `messages`, typed `LanguageModelV3ToolCall`, `tools`, `inputSchema`, and the SDK error.
- Remove all nine double assertions without replacing them with `any`, single assertions, or duplicated local callback interfaces.

Verification:

```bash
pnpm --filter api exec vitest run --project unit src/models/openai-model-client.tools.test.ts
pnpm --filter api typecheck
pnpm --filter api lint
rg -n "as unknown as|as any" apps/api/src/models/openai-model-client.tools.test.ts
```

The final search must return no matches.

## Task 3: Record and verify the layer

- Update the tracker from 80 to 71 remaining application/test cast lines and mark this coherent slice active until remote merge.
- Add a concise changelog entry with exact test evidence.
- Run independent spec and quality reviews, then fresh repository quality gates, lint, typecheck, Prettier, focused tests, and `git diff --check`.
- Commit locally on `quality-taser/openai-tool-test-types`; remote stack submission remains a separate authorized external write.
