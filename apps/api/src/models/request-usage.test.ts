import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { streamText, type LanguageModelUsage, type ModelMessage } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';

import type { ChatIdentity, ModelStreamInput } from './model-client';
import { applyRequestUsageCallback } from './request-usage';

const CHAT: ChatIdentity = { id: 'request-window-test', lane: 'main' };
const messages = [
  { role: 'user', content: 'Answer.' },
] satisfies Array<ModelMessage>;

const PROVIDER_USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
} satisfies LanguageModelV3Usage;

const INITIAL_DELAY_MS = 100;
const CHUNK_DELAY_MS = 50;

type Receipt = { usage: LanguageModelUsage; generationMs: number };

/** A scripted response's chunks: its parts, closed by the provider's finish. */
function finishedChunks(
  parts: ReadonlyArray<LanguageModelV3StreamPart>,
): Array<LanguageModelV3StreamPart> {
  return [
    { type: 'stream-start', warnings: [] },
    ...parts,
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: undefined },
      usage: PROVIDER_USAGE,
    },
  ];
}

/**
 * Streams one scripted provider response through the window-measuring
 * middleware and returns the receipts it reported. Timers are fake, so every
 * delay is exact: each chunk costs one `CHUNK_DELAY_MS` after the first, which
 * costs `INITIAL_DELAY_MS`.
 */
async function receiptsFrom(
  chunks: ReadonlyArray<LanguageModelV3StreamPart>,
): Promise<Array<Receipt>> {
  const model = new MockLanguageModelV3({
    provider: 'request-window.test',
    modelId: 'window-test',
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [...chunks],
          initialDelayInMs: INITIAL_DELAY_MS,
          chunkDelayInMs: CHUNK_DELAY_MS,
        }),
      }),
  });
  const streamOptions: Parameters<typeof streamText>[0] & {
    model: LanguageModelV3;
  } = { model, messages };
  const receipts: Array<Receipt> = [];
  const input: ModelStreamInput = {
    chat: CHAT,
    messages,
    onRequestUsage: (usage, generationMs) =>
      receipts.push({ usage, generationMs }),
  };
  applyRequestUsageCallback(streamOptions, input);

  const { stream } = await streamOptions.model.doStream({
    prompt: [],
  } satisfies LanguageModelV3CallOptions);
  const reading = (async () => {
    const reader = stream.getReader();
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
    }
  })();
  // Past the response's last chunk, so the reader drains and settles.
  await vi.advanceTimersByTimeAsync(
    INITIAL_DELAY_MS + CHUNK_DELAY_MS * (chunks.length + 2),
  );
  await reading;
  return receipts;
}

describe('provider request generation windows', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('measures a request from its first output delta to its finish', async () => {
    const receipts = await receiptsFrom(
      finishedChunks([
        { type: 'text-start', id: 'answer' },
        { type: 'text-delta', id: 'answer', delta: 'alpha' },
        { type: 'text-delta', id: 'answer', delta: 'beta' },
        { type: 'text-end', id: 'answer' },
      ]),
    );

    expect(receipts).toHaveLength(1);
    // Two chunks — the second delta and text-end — plus the finish follow the
    // first delta, each one chunk apart.
    expect(receipts[0]?.generationMs).toBe(3 * CHUNK_DELAY_MS);
    expect(receipts[0]?.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
    });
  });

  it('measures a request that streamed no output from its own start', async () => {
    const receipts = await receiptsFrom(
      finishedChunks([
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'bash',
          input: '{}',
        },
      ]),
    );

    // The adapter delivered the arguments as one part, so nothing opened the
    // window: the request contributes its whole span rather than dropping its
    // argument tokens out from under the rate.
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.generationMs).toBe(
      INITIAL_DELAY_MS + 2 * CHUNK_DELAY_MS,
    );
  });

  it('opens the window on a streamed tool call, which is output too', async () => {
    const receipts = await receiptsFrom(
      finishedChunks([
        { type: 'tool-input-start', id: 'call-1', toolName: 'bash' },
        { type: 'tool-input-delta', id: 'call-1', delta: '{"cmd":' },
        { type: 'tool-input-delta', id: 'call-1', delta: '"ls"}' },
      ]),
    );

    expect(receipts).toHaveLength(1);
    // The first argument fragment opens the window — the call's start part
    // carries no output — so the request's prefill stays out of it.
    expect(receipts[0]?.generationMs).toBe(2 * CHUNK_DELAY_MS);
  });

  it('does not open a window on an empty metadata-only delivery', async () => {
    const receipts = await receiptsFrom(
      finishedChunks([
        { type: 'reasoning-delta', id: 'thinking', delta: '' },
        { type: 'text-delta', id: 'answer', delta: 'alpha' },
      ]),
    );

    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.generationMs).toBe(CHUNK_DELAY_MS);
  });

  it('opens the window on a reasoning delta, which is streamed output too', async () => {
    const receipts = await receiptsFrom(
      finishedChunks([
        { type: 'reasoning-delta', id: 'thinking', delta: 'weighing' },
      ]),
    );

    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.generationMs).toBe(CHUNK_DELAY_MS);
  });

  it('reports nothing for a request that never finished', async () => {
    const receipts = await receiptsFrom([
      { type: 'stream-start', warnings: [] },
      { type: 'text-delta', id: 'answer', delta: 'alpha' },
    ]);

    // The stream ended without a finish part, so the request reported no usage
    // and no window: a retried failure contributes neither.
    expect(receipts).toEqual([]);
  });
});
