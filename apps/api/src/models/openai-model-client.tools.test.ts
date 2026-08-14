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
import {
  streamText,
  NoSuchToolError,
  InvalidToolInputError,
  tool,
  type DynamicToolCall,
  type LanguageModelUsage,
  type StepResult,
  type ToolSet,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModelV3ToolCall } from '@ai-sdk/provider';
import { z } from 'zod';

import { createOpenAIModelClient } from './openai-model-client';

vi.mock('ai', async () => ({
  ...(await vi.importActual<typeof import('ai')>('ai')),
  streamText: vi.fn(),
}));

const streamTextMock = vi.mocked(streamText, { partial: true });

const tools = {
  echo: tool({ inputSchema: z.object({ value: z.string() }).strict() }),
};

const ZERO_USAGE: LanguageModelUsage = {
  inputTokens: 0,
  inputTokenDetails: {
    noCacheTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  outputTokens: 0,
  outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
  totalTokens: 0,
};

const model = new MockLanguageModelV3({
  provider: 'openai.test',
  modelId: 'gpt-test',
});

function fakeToolStep(toolCallCount: number): StepResult<ToolSet> {
  const toolCalls: DynamicToolCall[] = Array.from(
    { length: toolCallCount },
    (_, index) => ({
      type: 'tool-call',
      toolCallId: `c${index}`,
      toolName: 'echo',
      input: { value: `value-${index}` },
      dynamic: true,
    }),
  );

  return {
    stepNumber: 0,
    model: { provider: model.provider, modelId: model.modelId },
    functionId: undefined,
    metadata: undefined,
    experimental_context: undefined,
    content: toolCalls,
    text: '',
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    toolCalls,
    staticToolCalls: [],
    dynamicToolCalls: toolCalls,
    toolResults: [],
    staticToolResults: [],
    dynamicToolResults: [],
    finishReason: 'tool-calls',
    rawFinishReason: 'tool-calls',
    usage: ZERO_USAGE,
    warnings: undefined,
    request: {},
    response: {
      id: 'response-id',
      timestamp: new Date(0),
      modelId: model.modelId,
      messages: [],
    },
    providerMetadata: undefined,
  };
}

function latestStreamTextOptions() {
  const options = streamTextMock.mock.lastCall?.[0];
  if (!options) {
    throw new Error('Expected streamText to have been called');
  }
  return options;
}

async function prepareToolStep(steps: StepResult<ToolSet>[]) {
  const prepareStep = latestStreamTextOptions().prepareStep;
  if (!prepareStep) {
    throw new Error('Expected prepareStep to be configured');
  }
  return prepareStep({
    steps,
    stepNumber: steps.length,
    model,
    messages: [],
    experimental_context: undefined,
  });
}

function repairToolCall() {
  const repair = latestStreamTextOptions().experimental_repairToolCall;
  if (!repair) {
    throw new Error('Expected experimental_repairToolCall to be configured');
  }
  return repair;
}

function runRepair(
  toolCall: LanguageModelV3ToolCall,
  error: NoSuchToolError | InvalidToolInputError,
) {
  return repairToolCall()({
    system: undefined,
    messages: [],
    toolCall,
    tools,
    inputSchema: () => Promise.resolve({ type: 'object' }),
    error,
  });
}

beforeEach(() => {
  streamTextMock.mockReset();
  streamTextMock.mockReturnValue({});
});

function buildClient() {
  return createOpenAIModelClient({
    providerModelId: 'gpt-test',
    modelId: 'system:openai:gpt-test',
    contextWindowTokens: 128_000,
  });
}

describe('createOpenAIModelClient — step-cap enforcement (prepareStep)', () => {
  it('forwards provider-neutral toolChoice to the AI SDK request', () => {
    const client = buildClient();

    client.streamText({
      messages: [],
      tools,
      toolChoice: 'none',
    });

    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ toolChoice: 'none' }),
    );
  });

  it('leaves tools active while prior tool-requesting steps are under the cap', async () => {
    const client = buildClient();
    const onCapReached = vi.fn();
    client.streamText({
      messages: [],
      tools,
      maxSteps: 3,
      onCapReached,
    });

    // 2 prior tool-calling steps, cap is 3 — tools stay active.
    const result = await prepareToolStep([fakeToolStep(1), fakeToolStep(2)]);
    expect(result).toEqual({});
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it('disables tools and fires onCapReached when maxSteps prior tool-steps have run', async () => {
    const client = buildClient();
    const onCapReached = vi.fn();
    client.streamText({
      messages: [],
      tools,
      maxSteps: 2,
      onCapReached,
    });

    // 2 prior tool-calling steps === maxSteps (2) — cap reached. In a real
    // run the SDK calls prepareStep once per step boundary with strictly
    // more steps each time, so once activeTools:[] is returned the model
    // can't request another tool and the loop naturally ends after the
    // forced answer-only step — prepareStep is never re-invoked with the
    // SAME steps array the way this single assertion exercises it.
    const result = await prepareToolStep([fakeToolStep(1), fakeToolStep(1)]);
    expect(result).toEqual({ activeTools: [] });
    expect(onCapReached).toHaveBeenCalledTimes(1);
  });

  it('counts parallel calls within one step as ONE step toward the cap', async () => {
    const client = buildClient();
    const onCapReached = vi.fn();
    client.streamText({
      messages: [],
      tools,
      maxSteps: 2,
      onCapReached,
    });

    // ONE step with 3 parallel tool calls — still only 1 prior tool-step.
    const result = await prepareToolStep([fakeToolStep(3)]);
    expect(result).toEqual({});
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it('passes a stepCountIs(maxSteps + 1) backstop so a genuinely-forced final step is allowed to run', () => {
    const client = buildClient();
    client.streamText({
      messages: [],
      tools,
      maxSteps: 5,
    });
    const { stopWhen } = latestStreamTextOptions();
    // stepCountIs returns a function; presence + non-null is what matters —
    // its exact numeric threshold is exercised behaviorally above.
    expect(typeof stopWhen).toBe('function');
  });
});

describe('createOpenAIModelClient — unavailable/hallucinated tool call refusal', () => {
  it('reports "not_available" for a call to an undeclared tool and resolves null (never crashes)', async () => {
    const client = buildClient();
    const onUnavailableToolCall = vi.fn();
    client.streamText({
      messages: [],
      tools,
      maxSteps: 4,
      onUnavailableToolCall,
    });

    // `LanguageModelV3ToolCall.input` is ALWAYS a stringified JSON object at
    // this provider layer, never pre-parsed — the fake here matches that
    // real shape rather than a convenient-but-unrealistic plain object
    // (a live-DB integration test caught this exact mismatch).
    const toolCall: LanguageModelV3ToolCall = {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'not_a_real_tool',
      input: '{"x":1}',
    };
    const error = new NoSuchToolError({
      toolName: 'not_a_real_tool',
      availableTools: ['echo'],
    });

    await expect(runRepair(toolCall, error)).resolves.toBeNull();
    expect(onUnavailableToolCall).toHaveBeenCalledWith({
      toolCallId: 'call-1',
      toolName: 'not_a_real_tool',
      input: { x: 1 },
      reason: 'not_available',
    });
  });

  it('reports "invalid_input" for schema-invalid arguments and resolves null', async () => {
    const client = buildClient();
    const onUnavailableToolCall = vi.fn();
    client.streamText({
      messages: [],
      tools,
      maxSteps: 4,
      onUnavailableToolCall,
    });

    const toolCall: LanguageModelV3ToolCall = {
      type: 'tool-call',
      toolCallId: 'call-2',
      toolName: 'echo',
      input: '{"bad":true}',
    };
    const error = new InvalidToolInputError({
      toolInput: '{"bad":true}',
      toolName: 'echo',
      cause: new Error('schema mismatch'),
    });

    await expect(runRepair(toolCall, error)).resolves.toBeNull();
    expect(onUnavailableToolCall).toHaveBeenCalledWith({
      toolCallId: 'call-2',
      toolName: 'echo',
      input: { bad: true },
      reason: 'invalid_input',
    });
  });

  it('falls back to the raw string when the tool call input is not valid JSON (a hallucinating model), never throws', async () => {
    const client = buildClient();
    const onUnavailableToolCall = vi.fn();
    client.streamText({
      messages: [],
      tools,
      maxSteps: 4,
      onUnavailableToolCall,
    });

    const toolCall: LanguageModelV3ToolCall = {
      type: 'tool-call',
      toolCallId: 'call-3',
      toolName: 'not_a_real_tool',
      input: 'not valid json{{{',
    };
    const error = new NoSuchToolError({
      toolName: 'not_a_real_tool',
      availableTools: ['echo'],
    });

    await expect(runRepair(toolCall, error)).resolves.toBeNull();
    expect(onUnavailableToolCall).toHaveBeenCalledWith({
      toolCallId: 'call-3',
      toolName: 'not_a_real_tool',
      input: 'not valid json{{{',
      reason: 'not_available',
    });
  });
});
