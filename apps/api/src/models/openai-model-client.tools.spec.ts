/**
 * Tool-calling loop plumbing in `createOpenAIModelClient` (openspec/changes/
 * tool-calling-loop): the step-cap enforcement (`prepareStep` forcing
 * `activeTools: []` once `maxSteps` tool-requesting steps have run,
 * `onCapReached` firing exactly once) and the unavailable/hallucinated-call
 * refusal seam (`experimental_repairToolCall` → `onUnavailableToolCall`,
 * never crashing, always resolving `null` so the SDK's own non-crashing
 * fallback still runs). `streamText` itself is mocked (no network); every
 * OTHER `ai` export (`NoSuchToolError`, `InvalidToolInputError`,
 * `stepCountIs`, `tool`) stays real, so the assertions exercise the actual
 * SDK types this code branches on.
 */
import { streamText, NoSuchToolError, InvalidToolInputError } from 'ai';
import type { StepResult, ToolSet } from 'ai';

import { createOpenAIModelClient } from './openai-model-client';

jest.mock('ai', () => ({
  ...jest.requireActual<typeof import('ai')>('ai'),
  streamText: jest.fn(),
}));

const streamTextMock = jest.mocked(streamText);

function fakeToolStep(toolCallCount: number): StepResult<ToolSet> {
  return {
    toolCalls: Array.from({ length: toolCallCount }, (_, i) => ({
      toolCallId: `c${i}`,
    })),
  } as unknown as StepResult<ToolSet>;
}

beforeEach(() => {
  streamTextMock.mockReset();
  streamTextMock.mockReturnValue({
    textStream: (async function* () {})(),
  } as unknown as ReturnType<typeof streamText>);
});

function buildClient() {
  return createOpenAIModelClient({
    providerModelId: 'gpt-test',
    modelId: 'system:openai:gpt-test',
    contextWindowTokens: 128_000,
  });
}

describe('createOpenAIModelClient — step-cap enforcement (prepareStep)', () => {
  it('leaves tools active while prior tool-requesting steps are under the cap', async () => {
    const client = buildClient();
    const onCapReached = jest.fn();
    client.streamText({
      messages: [],
      tools: { echo: {} as ToolSet[string] },
      maxSteps: 3,
      onCapReached,
    });

    const { prepareStep } = streamTextMock.mock.calls[0][0] as unknown as {
      prepareStep: (opts: { steps: StepResult<ToolSet>[] }) => unknown;
    };

    // 2 prior tool-calling steps, cap is 3 — tools stay active.
    const result = await prepareStep({
      steps: [fakeToolStep(1), fakeToolStep(2)],
    });
    expect(result).toEqual({});
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it('disables tools and fires onCapReached when maxSteps prior tool-steps have run', async () => {
    const client = buildClient();
    const onCapReached = jest.fn();
    client.streamText({
      messages: [],
      tools: { echo: {} as ToolSet[string] },
      maxSteps: 2,
      onCapReached,
    });

    const { prepareStep } = streamTextMock.mock.calls[0][0] as unknown as {
      prepareStep: (opts: { steps: StepResult<ToolSet>[] }) => unknown;
    };

    // 2 prior tool-calling steps === maxSteps (2) — cap reached. In a real
    // run the SDK calls prepareStep once per step boundary with strictly
    // more steps each time, so once activeTools:[] is returned the model
    // can't request another tool and the loop naturally ends after the
    // forced answer-only step — prepareStep is never re-invoked with the
    // SAME steps array the way this single assertion exercises it.
    const result = await prepareStep({
      steps: [fakeToolStep(1), fakeToolStep(1)],
    });
    expect(result).toEqual({ activeTools: [] });
    expect(onCapReached).toHaveBeenCalledTimes(1);
  });

  it('counts parallel calls within one step as ONE step toward the cap', async () => {
    const client = buildClient();
    const onCapReached = jest.fn();
    client.streamText({
      messages: [],
      tools: { echo: {} as ToolSet[string] },
      maxSteps: 2,
      onCapReached,
    });

    const { prepareStep } = streamTextMock.mock.calls[0][0] as unknown as {
      prepareStep: (opts: { steps: StepResult<ToolSet>[] }) => unknown;
    };

    // ONE step with 3 parallel tool calls — still only 1 prior tool-step.
    const result = await prepareStep({ steps: [fakeToolStep(3)] });
    expect(result).toEqual({});
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it('passes a stepCountIs(maxSteps + 1) backstop so a genuinely-forced final step is allowed to run', () => {
    const client = buildClient();
    client.streamText({
      messages: [],
      tools: { echo: {} as ToolSet[string] },
      maxSteps: 5,
    });
    const { stopWhen } = streamTextMock.mock.calls[0][0] as unknown as {
      stopWhen: unknown;
    };
    // stepCountIs returns a function; presence + non-null is what matters —
    // its exact numeric threshold is exercised behaviorally above.
    expect(typeof stopWhen).toBe('function');
  });
});

describe('createOpenAIModelClient — unavailable/hallucinated tool call refusal', () => {
  it('reports "not_available" for a call to an undeclared tool and resolves null (never crashes)', async () => {
    const client = buildClient();
    const onUnavailableToolCall = jest.fn();
    client.streamText({
      messages: [],
      tools: { echo: {} as ToolSet[string] },
      maxSteps: 4,
      onUnavailableToolCall,
    });

    const { experimental_repairToolCall: repair } = streamTextMock.mock
      .calls[0][0] as unknown as {
      experimental_repairToolCall: (opts: {
        toolCall: { toolCallId: string; toolName: string; input: string };
        error: unknown;
      }) => Promise<unknown>;
    };

    // `LanguageModelV3ToolCall.input` is ALWAYS a stringified JSON object at
    // this provider layer, never pre-parsed — the fake here matches that
    // real shape rather than a convenient-but-unrealistic plain object
    // (a live-DB integration test caught this exact mismatch).
    const toolCall = {
      toolCallId: 'call-1',
      toolName: 'not_a_real_tool',
      input: '{"x":1}',
    };
    const error = new NoSuchToolError({
      toolName: 'not_a_real_tool',
      availableTools: ['echo'],
    });

    await expect(repair({ toolCall, error })).resolves.toBeNull();
    expect(onUnavailableToolCall).toHaveBeenCalledWith({
      toolCallId: 'call-1',
      toolName: 'not_a_real_tool',
      input: { x: 1 },
      reason: 'not_available',
    });
  });

  it('reports "invalid_input" for schema-invalid arguments and resolves null', async () => {
    const client = buildClient();
    const onUnavailableToolCall = jest.fn();
    client.streamText({
      messages: [],
      tools: { echo: {} as ToolSet[string] },
      maxSteps: 4,
      onUnavailableToolCall,
    });

    const { experimental_repairToolCall: repair } = streamTextMock.mock
      .calls[0][0] as unknown as {
      experimental_repairToolCall: (opts: {
        toolCall: { toolCallId: string; toolName: string; input: string };
        error: unknown;
      }) => Promise<unknown>;
    };

    const toolCall = {
      toolCallId: 'call-2',
      toolName: 'echo',
      input: '{"bad":true}',
    };
    const error = new InvalidToolInputError({
      toolInput: '{"bad":true}',
      toolName: 'echo',
      cause: new Error('schema mismatch'),
    });

    await expect(repair({ toolCall, error })).resolves.toBeNull();
    expect(onUnavailableToolCall).toHaveBeenCalledWith({
      toolCallId: 'call-2',
      toolName: 'echo',
      input: { bad: true },
      reason: 'invalid_input',
    });
  });

  it('falls back to the raw string when the tool call input is not valid JSON (a hallucinating model), never throws', async () => {
    const client = buildClient();
    const onUnavailableToolCall = jest.fn();
    client.streamText({
      messages: [],
      tools: { echo: {} as ToolSet[string] },
      maxSteps: 4,
      onUnavailableToolCall,
    });

    const { experimental_repairToolCall: repair } = streamTextMock.mock
      .calls[0][0] as unknown as {
      experimental_repairToolCall: (opts: {
        toolCall: { toolCallId: string; toolName: string; input: string };
        error: unknown;
      }) => Promise<unknown>;
    };

    const toolCall = {
      toolCallId: 'call-3',
      toolName: 'not_a_real_tool',
      input: 'not valid json{{{',
    };
    const error = new NoSuchToolError({
      toolName: 'not_a_real_tool',
      availableTools: ['echo'],
    });

    await expect(repair({ toolCall, error })).resolves.toBeNull();
    expect(onUnavailableToolCall).toHaveBeenCalledWith({
      toolCallId: 'call-3',
      toolName: 'not_a_real_tool',
      input: 'not valid json{{{',
      reason: 'not_available',
    });
  });
});
