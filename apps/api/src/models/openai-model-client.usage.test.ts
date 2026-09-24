import type { OpenAIProvider } from '@ai-sdk/openai';
import type {
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import {
  simulateReadableStream,
  streamText,
  tool,
  type LanguageModelUsage,
  type ModelMessage,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

import type { ChatIdentity } from './model-client';
import { createOpenAIModelClient } from './openai-model-client';
import { FakeStreamingModelClient } from '../testing/fake-streaming-model-client';

const CHAT: ChatIdentity = { id: 'usage-test', lane: 'main' };
const messages = [
  { role: 'user', content: 'Use the tool.' },
] satisfies Array<ModelMessage>;

const toolRequestUsage = {
  inputTokens: { total: 111, noCache: 90, cacheRead: 11, cacheWrite: 10 },
  outputTokens: { total: 27, text: 20, reasoning: 7 },
  raw: { request: 'tool' },
} satisfies LanguageModelV3Usage;

const answerRequestUsage = {
  inputTokens: {
    total: 250,
    noCache: undefined,
    cacheRead: 50,
    cacheWrite: undefined,
  },
  outputTokens: { total: 30, text: undefined, reasoning: 4 },
  raw: { request: 'answer' },
} satisfies LanguageModelV3Usage;

function providerResponse(
  content: Array<LanguageModelV3StreamPart>,
  finishReason: 'stop' | 'tool-calls',
  usage: LanguageModelV3Usage,
) {
  return {
    stream: simulateReadableStream<LanguageModelV3StreamPart>({
      chunks: [
        { type: 'stream-start', warnings: [] },
        ...content,
        {
          type: 'finish',
          finishReason: { unified: finishReason, raw: undefined },
          usage,
        },
      ],
    }),
  };
}

describe('provider request usage receipts', () => {
  it('matches SDK step usage and records a tool request before its execution resolves', async () => {
    const responses = [
      providerResponse(
        [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'wait_for_release',
            input: '{"value":"ready"}',
          },
        ],
        'tool-calls',
        toolRequestUsage,
      ),
      providerResponse(
        [
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: 'done' },
          { type: 'text-end', id: 'answer' },
        ],
        'stop',
        answerRequestUsage,
      ),
    ];
    let responseIndex = 0;
    const model = new MockLanguageModelV3({
      provider: 'openai.test',
      modelId: 'gpt-test',
      doStream: () => {
        const response = responses[responseIndex++];
        if (response === undefined) {
          throw new Error('Missing scripted provider response');
        }
        return Promise.resolve(response);
      },
    });
    const provider = vi.fn<OpenAIProvider>();
    provider.mockReturnValue(model);
    const client = createOpenAIModelClient(
      {
        providerModelId: 'gpt-test',
        modelId: 'system:openai:gpt-test',
        contextWindowTokens: 128_000,
        userAgent: 'llame/test',
      },
      { createOpenAI: () => provider, streamText },
    );

    const receipts: Array<LanguageModelUsage> = [];
    const onFinish = vi.fn();
    let startTool: () => void = () => undefined;
    const toolStarted = new Promise<void>((resolve) => {
      startTool = resolve;
    });
    let releaseTool: () => void = () => undefined;
    const toolGate = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    let toolResolved = false;

    const result = client.streamText({
      chat: CHAT,
      messages,
      maxSteps: 4,
      tools: {
        wait_for_release: tool({
          inputSchema: z.object({ value: z.string() }),
          execute: async ({ value }) => {
            startTool();
            await toolGate;
            toolResolved = true;
            return value;
          },
        }),
      },
      onRequestUsage: (usage) => receipts.push(usage),
      onFinish,
    });
    const text = result.text;

    await toolStarted;
    let receiptCountWhileToolPending = 0;
    let toolWasPendingWhenReceiptWasChecked = false;
    try {
      await vi.waitFor(() => {
        expect(receipts).toHaveLength(1);
      });
      receiptCountWhileToolPending = receipts.length;
      toolWasPendingWhenReceiptWasChecked = !toolResolved;
    } finally {
      releaseTool();
    }

    await expect(text).resolves.toBe('done');
    const steps = await result.steps;
    expect(receiptCountWhileToolPending).toBe(1);
    expect(toolWasPendingWhenReceiptWasChecked).toBe(true);
    expect(receipts).toStrictEqual(steps.map((step) => step.usage));
    expect(receipts).toHaveLength(2);
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ stepCount: 2 }),
    );
  });

  it('uses the shared receipt path in the streaming test client', async () => {
    const client = new FakeStreamingModelClient();
    const receipts: Array<LanguageModelUsage> = [];
    const onFinish = vi.fn();
    const result = client.streamText({
      chat: CHAT,
      messages,
      onRequestUsage: (usage) => receipts.push(usage),
      onFinish,
    });

    await expect(result.text).resolves.toBe('fake assistant');
    const steps = await result.steps;
    expect(receipts).toStrictEqual(steps.map((step) => step.usage));
    expect(receipts).toHaveLength(1);
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ stepCount: 1 }),
    );
  });
});
