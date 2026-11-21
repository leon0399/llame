import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import { MockLanguageModelV3 } from 'ai/test';

import { classifyCompletions } from './provider-failure/classify-completions';
import {
  FAILURE_CLASSES,
  ProviderFailure,
} from './provider-failure/provider-failure';
import { withRequestRecovery } from './request-recovery';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

const complete: Array<LanguageModelV3StreamPart> = [
  { type: 'text-start', id: 'answer' },
  { type: 'text-delta', id: 'answer', delta: 'Recovered answer.' },
  { type: 'text-end', id: 'answer' },
  { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
];

const options = { provider: 'openai', classify: classifyCompletions };
const immediate = { random: () => 0, delay: () => Promise.resolve() };

const overloaded = () =>
  new ProviderFailure('Provider overload', { code: 'overloaded' });

function scriptedModel(
  scripts: Array<Array<LanguageModelV3StreamPart> | Error>,
) {
  let sends = 0;

  const model = new MockLanguageModelV3({
    doStream: () => {
      const script = scripts[Math.min(sends, scripts.length - 1)];
      sends += 1;

      if (script instanceof Error) return Promise.reject(script);

      if (script === undefined) throw new Error('Missing send fixture');

      return Promise.resolve({
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            for (const part of script) controller.enqueue(part);
            controller.close();
          },
        }),
      });
    },
  });

  return { model, sends: () => sends };
}

async function collect(model: LanguageModelV3, signal?: AbortSignal) {
  const result = await model.doStream({ prompt: [], abortSignal: signal });
  const reader = result.stream.getReader();
  const parts: Array<LanguageModelV3StreamPart> = [];

  for (;;) {
    const item = await reader.read();

    if (item.done) return parts;
    parts.push(item.value);
  }
}

function providerFailureFrom(
  parts: Array<LanguageModelV3StreamPart>,
): ProviderFailure {
  const last = parts.at(-1);
  const error: unknown = last?.type === 'error' ? last.error : undefined;

  if (!(error instanceof ProviderFailure))
    throw new Error('Expected a typed provider failure.');

  return error;
}

function controlledModel() {
  const controllers: Array<
    ReadableStreamDefaultController<LanguageModelV3StreamPart>
  > = [];

  const cancelled: Array<unknown> = [];

  const model = new MockLanguageModelV3({
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controllers.push(controller);
          },
          cancel(reason) {
            cancelled.push(reason);
          },
        }),
      }),
  });

  return { model, controllers, cancelled };
}

function sendController(
  controllers: Array<
    ReadableStreamDefaultController<LanguageModelV3StreamPart>
  >,
  index: number,
) {
  const controller = controllers[index];

  if (controller === undefined)
    throw new Error('The expected send has not started');

  return controller;
}

function finish(
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
) {
  for (const part of complete) controller.enqueue(part);
  controller.close();
}

function text(parts: Array<LanguageModelV3StreamPart>) {
  return parts
    .flatMap((part) => (part.type === 'text-delta' ? [part.delta] : []))
    .join('');
}

afterEach(() => vi.useRealTimers());

it.each([
  { failureClass: 'quota_exhausted', tool: false },
  { failureClass: 'quota_exhausted', tool: true },
  { failureClass: 'rate_limited', tool: false },
  { failureClass: 'rate_limited', tool: true },
] as const)(
  'retains the complete-tool $failureClass cutoff at the stream boundary (tool=$tool)',
  async ({ failureClass, tool }) => {
    const resetsAt = Date.now() + 3_600_000;

    const prefix: Array<LanguageModelV3StreamPart> = tool
      ? [
          {
            type: 'tool-call',
            toolCallId: 'quota-call',
            toolName: 'search',
            input: '{}',
          },
        ]
      : [
          { type: 'text-start', id: 'quota-draft' },
          { type: 'text-delta', id: 'quota-draft', delta: 'partial answer' },
        ];

    const fixture = scriptedModel([
      [
        ...prefix,
        {
          type: 'error',
          error: new ProviderFailure('Usage limit', {
            code: failureClass,
            resetsAt,
          }),
        },
      ],
    ]);

    const parts = await collect(
      withRequestRecovery(fixture.model, options, immediate),
    );

    const failure = providerFailureFrom(parts);
    expect(failure).toMatchObject({
      code: failureClass,
      resetsAt,
    });
    expect(failure.toolCallStarted).toBe(tool ? true : undefined);
    expect(fixture.sends()).toBe(1);
  },
);

it.each(FAILURE_CLASSES)(
  'does not send a %s failure again after a complete tool-call part',
  async (failureClass) => {
    const fixture = scriptedModel([
      [
        {
          type: 'tool-call',
          toolCallId: 'started-call',
          toolName: 'read',
          input: '{}',
        },
        {
          type: 'error',
          error: new ProviderFailure('Provider failure', {
            code: failureClass,
          }),
        },
      ],
      complete,
    ]);

    const parts = await collect(
      withRequestRecovery(fixture.model, options, immediate),
    );

    expect(providerFailureFrom(parts)).toMatchObject({
      code: failureClass,
      toolCallStarted: true,
      sends: 1,
    });
    expect(fixture.sends()).toBe(1);
  },
);

it('preserves safe failure metadata on a started call', async () => {
  const now = Date.now();

  const fixture = scriptedModel([
    [
      {
        type: 'tool-call',
        toolCallId: 'metadata-call',
        toolName: 'read',
        input: '{}',
      },
      {
        type: 'error',
        error: new ProviderFailure('Provider error', {
          code: 'server_error',
          resetsAt: now + 1000,
          hintMs: 0,
          statusCode: 503,
        }),
      },
    ],
    complete,
  ]);

  const parts = await collect(
    withRequestRecovery(fixture.model, options, immediate),
  );

  expect(providerFailureFrom(parts)).toMatchObject({
    code: 'server_error',
    resetsAt: now + 1000,
    hintMs: 0,
    statusCode: 503,
    toolCallStarted: true,
    sends: 1,
  });
  expect(fixture.sends()).toBe(1);
});

describe('withRequestRecovery', () => {
  it('drops metadata from repeated failed sends and forwards one successful usage receipt', async () => {
    const failed: Array<LanguageModelV3StreamPart> = [
      { type: 'reasoning-start', id: 'discarded' },
      { type: 'error', error: overloaded() },
      {
        type: 'finish',
        finishReason: { unified: 'error', raw: undefined },
        usage: { ...usage, inputTokens: { ...usage.inputTokens, total: 999 } },
      },
    ];

    const fixture = scriptedModel([failed, failed, complete]);

    const parts = await collect(
      withRequestRecovery(fixture.model, options, immediate),
    );

    expect(fixture.sends()).toBe(3);
    expect(text(parts)).toBe('Recovered answer.');
    expect(parts.filter((part) => part.type === 'finish')).toMatchObject([
      { usage },
    ]);
    expect(parts.some((part) => part.type === 'reasoning-start')).toBe(false);
  });

  it('shares the eleven-send ceiling across streamed failures and header failures', async () => {
    const fixture = scriptedModel([
      [{ type: 'error', error: overloaded() }],
      overloaded(),
    ]);

    const retries: Array<number> = [];

    const model = withRequestRecovery(
      fixture.model,
      {
        ...options,
        onRetry: ({ retry }) => {
          retries.push(retry);
        },
      },
      immediate,
    );

    const parts = await collect(model);

    expect(fixture.sends()).toBe(11);
    expect(retries).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(parts).toMatchObject([
      { type: 'error', error: { code: 'overloaded' } },
    ]);
  });

  it('awaits retry persistence before delaying or sending again', async () => {
    const fixture = scriptedModel([overloaded(), complete]);
    const entered = Promise.withResolvers<void>();
    const persisted = Promise.withResolvers<void>();
    let delayed = false;

    const model = withRequestRecovery(
      fixture.model,
      {
        ...options,
        onRetry: async () => {
          entered.resolve();
          await persisted.promise;
        },
      },
      {
        random: () => 0,
        delay: () => {
          delayed = true;

          return Promise.resolve();
        },
      },
    );

    const pending = collect(model);
    await entered.promise;

    expect(fixture.sends()).toBe(1);
    expect(delayed).toBe(false);
    persisted.resolve();
    expect(text(await pending)).toBe('Recovered answer.');
    expect(fixture.sends()).toBe(2);
  });

  it('reports the owner retry callback exception without another send', async () => {
    const fixture = scriptedModel([
      [{ type: 'error', error: overloaded() }],
      complete,
    ]);

    const ownerError = new Error('Retry persistence failed');

    const model = withRequestRecovery(
      fixture.model,
      {
        ...options,
        onRetry: () => {
          throw ownerError;
        },
      },
      immediate,
    );

    const parts = await collect(model);

    expect(parts).toEqual([{ type: 'error', error: ownerError }]);
    expect(fixture.sends()).toBe(1);
  });

  it('honors an authoritative short reset after recording the retry', async () => {
    const now = 1_900_000_000_000;

    const fixture = scriptedModel([
      new ProviderFailure('Quota', {
        code: 'quota_exhausted',
        resetsAt: now + 20_000,
      }),
      complete,
    ]);

    const order: Array<string> = [];
    const delays: Array<number> = [];

    const model = withRequestRecovery(
      fixture.model,
      {
        ...options,
        onRetry: () => {
          order.push('recorded');
        },
      },
      {
        now: () => now,
        random: () => 0.5,
        delay: (milliseconds) => {
          order.push('delayed');
          delays.push(milliseconds);

          return Promise.resolve();
        },
      },
    );

    expect(text(await collect(model))).toBe('Recovered answer.');
    expect(order).toEqual(['recorded', 'delayed']);
    expect(delays).toEqual([20_000]);
  });

  it('admits a quota reset exactly sixty seconds away', async () => {
    const now = 1_900_000_000_000;

    const fixture = scriptedModel([
      new ProviderFailure('Quota', {
        code: 'quota_exhausted',
        resetsAt: now + 60_000,
      }),
      complete,
    ]);

    const delays: Array<number> = [];

    const model = withRequestRecovery(fixture.model, options, {
      now: () => now,
      random: () => 0,
      delay: (milliseconds) => {
        delays.push(milliseconds);

        return Promise.resolve();
      },
    });

    expect(text(await collect(model))).toBe('Recovered answer.');
    expect(fixture.sends()).toBe(2);
    expect(delays).toEqual([60_000]);
  });

  it('admits a rate-limit hint exactly sixty seconds away', async () => {
    const fixture = scriptedModel([
      new ProviderFailure('Rate limit', {
        code: 'rate_limited',
        hintMs: 60_000,
      }),
      complete,
    ]);

    const delays: Array<number> = [];

    const model = withRequestRecovery(fixture.model, options, {
      random: () => 0,
      delay: (milliseconds) => {
        delays.push(milliseconds);

        return Promise.resolve();
      },
    });

    expect(text(await collect(model))).toBe('Recovered answer.');
    expect(fixture.sends()).toBe(2);
    expect(delays).toEqual([60_000]);
  });

  it('uses progressive full-jitter windows capped at eight seconds', async () => {
    const fixture = scriptedModel([
      ...Array.from({ length: 10 }, () => overloaded()),
      complete,
    ]);

    const delays: Array<number> = [];

    const model = withRequestRecovery(fixture.model, options, {
      random: () => 0.999,
      delay: (milliseconds) => {
        delays.push(milliseconds);

        return Promise.resolve();
      },
    });

    expect(text(await collect(model))).toBe('Recovered answer.');
    expect(fixture.sends()).toBe(11);
    expect(delays).toEqual([
      499, 999, 1998, 3996, 7992, 7992, 7992, 7992, 7992, 7992,
    ]);
  });

  it.each(['unreachable', 'server_error', 'overloaded'] as const)(
    'retries a %s request failure',
    async (code) => {
      const fixture = scriptedModel([
        new ProviderFailure('Transient request failure', { code }),
        complete,
      ]);

      expect(
        text(
          await collect(withRequestRecovery(fixture.model, options, immediate)),
        ),
      ).toBe('Recovered answer.');
      expect(fixture.sends()).toBe(2);
    },
  );

  it('does not turn a long rate-limit hint into an in-process retry', async () => {
    const fixture = scriptedModel([
      new ProviderFailure('Rate limit', {
        code: 'rate_limited',
        hintMs: 60_001,
      }),
      complete,
    ]);

    await expect(
      collect(withRequestRecovery(fixture.model, options, immediate)),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(fixture.sends()).toBe(1);
  });

  it('ignores a long overload hint rather than sleeping for it', async () => {
    const fixture = scriptedModel([
      new ProviderFailure('Overload', { code: 'overloaded', hintMs: 120_000 }),
      complete,
    ]);

    const delays: Array<number> = [];

    const model = withRequestRecovery(fixture.model, options, {
      random: () => 0.5,
      delay: (milliseconds) => {
        delays.push(milliseconds);

        return Promise.resolve();
      },
    });

    expect(text(await collect(model))).toBe('Recovered answer.');
    expect(delays).toEqual([250]);
  });

  it('fails a long authoritative reset without consuming a retry', async () => {
    const now = Date.now();

    const fixture = scriptedModel([
      new ProviderFailure('Quota', {
        code: 'quota_exhausted',
        resetsAt: now + 60_001,
      }),
      complete,
    ]);

    await expect(
      collect(
        withRequestRecovery(fixture.model, options, {
          ...immediate,
          now: () => now,
        }),
      ),
    ).rejects.toMatchObject({ code: 'quota_exhausted' });
    expect(fixture.sends()).toBe(1);
  });

  it('counts signature-only reasoning and repeated metadata inside the first window', async () => {
    vi.useFakeTimers();
    const fixture = controlledModel();

    const pending = collect(
      withRequestRecovery(fixture.model, options, immediate),
    );

    await vi.advanceTimersByTimeAsync(0);
    const first = sendController(fixture.controllers, 0);
    first.enqueue({ type: 'reasoning-start', id: 'discarded' });
    await vi.advanceTimersByTimeAsync(100_000);
    first.enqueue({
      type: 'reasoning-delta',
      id: 'discarded',
      delta: '',
      providerMetadata: { anthropic: { signature: 'metadata-only' } },
    });
    await vi.advanceTimersByTimeAsync(199_999);
    expect(fixture.controllers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    finish(sendController(fixture.controllers, 1));
    const parts = await pending;

    expect(fixture.cancelled).toHaveLength(1);
    expect(text(parts)).toBe('Recovered answer.');
    expect(parts.some((part) => part.type === 'reasoning-start')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows content after ten minutes when the model first window is fifteen minutes', async () => {
    vi.useFakeTimers();
    const fixture = controlledModel();

    const pending = collect(
      withRequestRecovery(
        fixture.model,
        { ...options, firstTokenTimeoutSeconds: 900 },
        immediate,
      ),
    );

    await vi.advanceTimersByTimeAsync(600_000);
    finish(sendController(fixture.controllers, 0));

    expect(text(await pending)).toBe('Recovered answer.');
    expect(fixture.controllers).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a first-content window longer than the native timer maximum', async () => {
    vi.useFakeTimers();
    const fixture = controlledModel();

    const pending = collect(
      withRequestRecovery(
        fixture.model,
        { ...options, firstTokenTimeoutSeconds: 3_000_000 },
        immediate,
      ),
    );

    await vi.advanceTimersByTimeAsync(600_000);
    expect(fixture.controllers).toHaveLength(1);
    finish(sendController(fixture.controllers, 0));

    expect(text(await pending)).toBe('Recovered answer.');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails a live stream after five minutes of silence following content', async () => {
    vi.useFakeTimers();
    const fixture = controlledModel();

    const pending = collect(
      withRequestRecovery(fixture.model, options, immediate),
    );

    await vi.advanceTimersByTimeAsync(0);
    const controller = sendController(fixture.controllers, 0);
    controller.enqueue({ type: 'text-start', id: 'answer' });
    controller.enqueue({
      type: 'text-delta',
      id: 'answer',
      delta: 'Partial answer.',
    });
    await vi.advanceTimersByTimeAsync(299_999);
    expect(fixture.controllers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const parts = await pending;

    expect(text(parts)).toBe('Partial answer.');
    expect(parts.at(-1)).toMatchObject({
      type: 'error',
      error: { code: 'stream_broken' },
    });
    expect(fixture.controllers).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not count a paused tool consumer as provider silence', async () => {
    vi.useFakeTimers();

    const fixture = scriptedModel([
      [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'read',
          input: '{}',
        },
        {
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage,
        },
      ],
    ]);

    const result = await withRequestRecovery(
      fixture.model,
      options,
      immediate,
    ).doStream({ prompt: [] });

    const reader = result.stream.getReader();

    expect((await reader.read()).value).toMatchObject({ type: 'tool-call' });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(vi.getTimerCount()).toBe(0);
    expect((await reader.read()).value).toMatchObject({ type: 'finish' });
    expect((await reader.read()).done).toBe(true);
    expect(fixture.sends()).toBe(1);
  });

  it('releases an empty successful send at finish without retrying it', async () => {
    const fixture = scriptedModel([
      [
        { type: 'response-metadata', id: 'empty' },
        {
          type: 'finish',
          finishReason: { unified: 'content-filter', raw: undefined },
          usage,
        },
      ],
    ]);

    const parts = await collect(
      withRequestRecovery(fixture.model, options, immediate),
    );

    expect(parts.map((part) => part.type)).toEqual([
      'response-metadata',
      'finish',
    ]);
    expect(fixture.sends()).toBe(1);
  });

  it('fails a released live stream but retries the same break for a buffered summary', async () => {
    const broken: Array<LanguageModelV3StreamPart> = [
      { type: 'text-start', id: 'failed' },
      { type: 'text-delta', id: 'failed', delta: 'Partial answer.' },
    ];

    const live = scriptedModel([broken, complete]);

    const liveParts = await collect(
      withRequestRecovery(live.model, options, immediate),
    );

    const summary = scriptedModel([broken, complete]);

    const summaryParts = await collect(
      withRequestRecovery(
        summary.model,
        { ...options, bufferWholeSend: true },
        immediate,
      ),
    );

    expect(text(liveParts)).toBe('Partial answer.');
    expect(liveParts.at(-1)).toMatchObject({
      type: 'error',
      error: {
        code: 'stream_broken',
        superseded: { retry: 1, delayMs: 0 },
      },
    });
    expect(live.sends()).toBe(1);
    expect(text(summaryParts)).toBe('Recovered answer.');
    expect(summary.sends()).toBe(2);
  });
  it('retains safe failure metadata on a live break without retaining its raw cause', async () => {
    const rawCause = new Error('private provider response body');
    const resetsAt = Date.now();

    const original = new ProviderFailure('Provider rate limit', {
      code: 'rate_limited',
      resetsAt,
      hintMs: 30_000,
      statusCode: 429,
    });

    Object.defineProperty(original, 'cause', { value: rawCause });

    const fixture = scriptedModel([
      [
        { type: 'text-start', id: 'partial' },
        { type: 'text-delta', id: 'partial', delta: 'Partial answer.' },
        { type: 'error', error: original },
      ],
    ]);

    const parts = await collect(
      withRequestRecovery(fixture.model, options, immediate),
    );

    const failure = providerFailureFrom(parts);

    expect(text(parts)).toBe('Partial answer.');
    expect(failure).not.toBe(original);
    expect(failure).toMatchObject({
      code: 'rate_limited',
      resetsAt,
      hintMs: 30_000,
      statusCode: 429,
      superseded: { retry: 1, delayMs: 30_000 },
    });
    expect(failure.cause).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain(
      'private provider response body',
    );
    expect(fixture.sends()).toBe(1);
  });
  it('preserves zero-valued safe metadata on a superseded live failure', async () => {
    const original = new ProviderFailure('Provider limit', {
      code: 'rate_limited',
      resetsAt: 0,
      hintMs: 0,
      statusCode: 429,
    });

    const fixture = scriptedModel([
      [
        { type: 'text-start', id: 'partial' },
        { type: 'text-delta', id: 'partial', delta: 'Visible prefix.' },
        { type: 'error', error: original },
      ],
    ]);

    const parts = await collect(
      withRequestRecovery(fixture.model, options, immediate),
    );

    const failure = providerFailureFrom(parts);

    expect(text(parts)).toBe('Visible prefix.');
    expect(parts.at(-1)).toMatchObject({ type: 'error', error: failure });
    expect(failure).toMatchObject({
      code: 'rate_limited',
      resetsAt: 0,
      hintMs: 0,
      statusCode: 429,
      superseded: { retry: 1, delayMs: 0 },
    });
    expect(fixture.sends()).toBe(1);
  });

  it('discards buffered content when a whole send fails after producing it', async () => {
    const failure = new ProviderFailure('Quota exhausted', {
      code: 'quota_exhausted',
      resetsAt: 1_900_000_000_000,
      hintMs: 60_000,
      statusCode: 429,
    });

    const fixture = scriptedModel([
      [
        { type: 'text-start', id: 'summary' },
        { type: 'text-delta', id: 'summary', delta: 'Must not escape.' },
        { type: 'error', error: failure },
      ],
      complete,
    ]);

    const parts = await collect(
      withRequestRecovery(
        fixture.model,
        { ...options, bufferWholeSend: true },
        immediate,
      ),
    );

    expect(parts).toEqual([{ type: 'error', error: failure }]);
    expect(text(parts)).toBe('');
    expect(providerFailureFrom(parts)).toMatchObject({
      code: 'quota_exhausted',
      resetsAt: 1_900_000_000_000,
      hintMs: 60_000,
      statusCode: 429,
    });
    expect(providerFailureFrom(parts).superseded).toBeUndefined();
    expect(fixture.sends()).toBe(1);
  });
  it('does not label an empty exhausted send as superseding visible content', async () => {
    const fixture = scriptedModel(
      Array.from({ length: 11 }, () => [
        { type: 'error', error: overloaded() },
      ]),
    );

    const parts = await collect(
      withRequestRecovery(fixture.model, options, immediate),
    );

    expect(parts).toHaveLength(1);
    expect(providerFailureFrom(parts).superseded).toBeUndefined();
    expect(fixture.sends()).toBe(11);
  });

  it('retries a buffered whole-send provider error without exposing its prefix', async () => {
    const fixture = scriptedModel([
      [
        { type: 'text-start', id: 'failed' },
        {
          type: 'error',
          error: new ProviderFailure('Temporary failure', {
            code: 'server_error',
          }),
        },
      ],
      complete,
    ]);

    const parts = await collect(
      withRequestRecovery(
        fixture.model,
        { ...options, bufferWholeSend: true },
        immediate,
      ),
    );

    expect(text(parts)).toBe('Recovered answer.');
    expect(
      parts.some((part) => part.type === 'text-start' && part.id === 'failed'),
    ).toBe(false);
  });

  it('does not retry a buffered provider tool call even for a transient failure', async () => {
    const fixture = scriptedModel([
      [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'search',
          input: '{}',
        },
        { type: 'error', error: overloaded() },
      ],
      complete,
    ]);

    const parts = await collect(
      withRequestRecovery(
        fixture.model,
        { ...options, bufferWholeSend: true },
        immediate,
      ),
    );

    expect(parts).toMatchObject([
      { type: 'error', error: { code: 'overloaded' } },
    ]);
    expect(fixture.sends()).toBe(1);
  });

  it('supersedes partial reasoning without invoking the retry owner', async () => {
    const fixture = scriptedModel([
      [
        { type: 'reasoning-start', id: 'thought' },
        { type: 'reasoning-delta', id: 'thought', delta: 'partial thought' },
        {
          type: 'error',
          error: new ProviderFailure('Provider overload', {
            code: 'overloaded',
            statusCode: 503,
            hintMs: 0,
          }),
        },
      ],
      complete,
    ]);

    const retries: Array<number> = [];
    const delays: Array<number> = [];

    const parts = await collect(
      withRequestRecovery(
        fixture.model,
        {
          ...options,
          onRetry: ({ retry }) => {
            retries.push(retry);
          },
        },
        {
          ...immediate,
          delay: (milliseconds) => {
            delays.push(milliseconds);

            return Promise.resolve();
          },
        },
      ),
    );

    expect(parts).toContainEqual(
      expect.objectContaining({
        type: 'reasoning-delta',
        delta: 'partial thought',
      }),
    );
    expect(parts.at(-1)).toMatchObject({
      type: 'error',
      error: {
        code: 'overloaded',
        statusCode: 503,
        hintMs: 0,
        superseded: { retry: 1, delayMs: 0 },
      },
    });
    expect(retries).toEqual([]);
    expect(delays).toEqual([]);
    expect(fixture.sends()).toBe(1);
  });

  it('does not supersede a live stream after a complete tool call', async () => {
    const fixture = scriptedModel([
      [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'search',
          input: '{}',
        },
        { type: 'error', error: overloaded() },
      ],
      complete,
    ]);

    const parts = await collect(
      withRequestRecovery(fixture.model, options, immediate),
    );

    expect(parts).toMatchObject([
      { type: 'tool-call', toolCallId: 'call-1' },
      { type: 'error', error: { code: 'overloaded' } },
    ]);
    expect(providerFailureFrom(parts).superseded).toBeUndefined();
    expect(fixture.sends()).toBe(1);
  });

  it('carries the send budget across hidden failures and a live restart', async () => {
    const liveFailure: Array<LanguageModelV3StreamPart> = [
      { type: 'text-start', id: 'partial' },
      { type: 'text-delta', id: 'partial', delta: 'partial' },
      { type: 'error', error: overloaded() },
    ];

    const fixture = scriptedModel([overloaded(), liveFailure, liveFailure]);

    const initial = await collect(
      withRequestRecovery(
        fixture.model,
        { ...options, requestRetriesUsed: 8 },
        immediate,
      ),
    );

    expect(initial.at(-1)).toMatchObject({
      type: 'error',
      error: { superseded: { retry: 10, delayMs: 0 } },
    });

    const restarted = await collect(
      withRequestRecovery(
        fixture.model,
        { ...options, requestRetriesUsed: 10 },
        immediate,
      ),
    );

    expect(restarted.at(-1)).toMatchObject({
      type: 'error',
      error: { code: 'overloaded' },
    });
    expect(providerFailureFrom(restarted).superseded).toBeUndefined();
    expect(fixture.sends()).toBe(3);
  });

  it('resets the carried budget after the first wrapped SDK step', async () => {
    const fixture = scriptedModel([
      [
        { type: 'text-start', id: 'first' },
        { type: 'text-delta', id: 'first', delta: 'first' },
        { type: 'error', error: overloaded() },
      ],
      [
        { type: 'text-start', id: 'second' },
        { type: 'text-delta', id: 'second', delta: 'second' },
        { type: 'error', error: overloaded() },
      ],
    ]);

    const model = withRequestRecovery(
      fixture.model,
      { ...options, requestRetriesUsed: 10 },
      immediate,
    );

    const firstStep = await collect(model);
    const secondStep = await collect(model);

    expect(providerFailureFrom(firstStep).superseded).toBeUndefined();
    expect(secondStep.at(-1)).toMatchObject({
      error: { superseded: { retry: 1, delayMs: 0 } },
    });
    expect(fixture.sends()).toBe(2);
  });

  it('keeps a carried started-call failure across a live supersede', async () => {
    const fixture = scriptedModel([
      [
        { type: 'text-start', id: 'partial' },
        { type: 'text-delta', id: 'partial', delta: 'partial' },
        {
          type: 'error',
          error: new ProviderFailure('Provider overload', {
            code: 'overloaded',
            toolCallStarted: true,
            sends: 5,
          }),
        },
      ],
    ]);

    const parts = await collect(
      withRequestRecovery(fixture.model, options, immediate),
    );

    expect(providerFailureFrom(parts)).toMatchObject({
      code: 'overloaded',
      toolCallStarted: true,
      sends: 5,
      superseded: { retry: 1, delayMs: 0 },
    });
    expect(fixture.sends()).toBe(1);
  });

  it('waits the carried retry number before the first send of the next step', async () => {
    const fixture = scriptedModel([complete]);
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const onRetry = vi.fn();

    const model = withRequestRecovery(
      fixture.model,
      {
        ...options,
        requestRetriesUsed: 3,
        pendingFailure: new ProviderFailure('Provider error', {
          code: 'server_error',
        }),
        onRetry,
      },
      {
        random: () => 0.5,
        delay: () => {
          entered.resolve();

          return released.promise;
        },
      },
    );

    const pending = collect(model);
    await entered.promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({
      code: 'server_error',
      retry: 3,
      delayMs: 1000,
    });
    expect(fixture.sends()).toBe(0);

    released.resolve();
    expect(text(await pending)).toBe('Recovered answer.');
    expect(fixture.sends()).toBe(1);
  });

  it('waits the provider delay when it exceeds the jitter of a pending retry', async () => {
    const fixture = scriptedModel([complete]);
    const delays: Array<number> = [];

    const model = withRequestRecovery(
      fixture.model,
      {
        ...options,
        requestRetriesUsed: 1,
        pendingFailure: new ProviderFailure('Rate limit', {
          code: 'rate_limited',
          hintMs: 1500,
        }),
      },
      {
        random: () => 0.5,
        delay: (milliseconds) => {
          delays.push(milliseconds);

          return Promise.resolve();
        },
      },
    );

    expect(text(await collect(model))).toBe('Recovered answer.');
    expect(delays).toEqual([1500]);
    expect(fixture.sends()).toBe(1);
  });

  it('fails without a send when no retry is left for the next step', async () => {
    const fixture = scriptedModel([complete]);
    const onRetry = vi.fn();

    const model = withRequestRecovery(
      fixture.model,
      {
        ...options,
        requestRetriesUsed: 11,
        pendingFailure: overloaded(),
        onRetry,
      },
      immediate,
    );

    await expect(collect(model)).rejects.toMatchObject({ code: 'overloaded' });
    expect(fixture.sends()).toBe(0);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('fails a pending authentication failure without a send', async () => {
    const fixture = scriptedModel([complete]);

    const model = withRequestRecovery(
      fixture.model,
      {
        ...options,
        pendingFailure: new ProviderFailure('Authentication failure', {
          code: 'auth',
        }),
      },
      immediate,
    );

    await expect(collect(model)).rejects.toMatchObject({ code: 'auth' });
    expect(fixture.sends()).toBe(0);
  });

  it('applies a pending failure to the first wrapped stream only', async () => {
    const fixture = scriptedModel([complete, complete]);
    const retries: Array<number> = [];
    const delays: Array<number> = [];

    const model = withRequestRecovery(
      fixture.model,
      {
        ...options,
        requestRetriesUsed: 2,
        pendingFailure: overloaded(),
        onRetry: ({ retry }) => {
          retries.push(retry);
        },
      },
      {
        random: () => 0,
        delay: (milliseconds) => {
          delays.push(milliseconds);

          return Promise.resolve();
        },
      },
    );

    expect(text(await collect(model))).toBe('Recovered answer.');
    expect(text(await collect(model))).toBe('Recovered answer.');
    expect(retries).toEqual([2]);
    expect(delays).toEqual([0]);
    expect(fixture.sends()).toBe(2);
  });

  it('preserves caller cancellation during an uncooperative header wait', async () => {
    const requested = Promise.withResolvers<void>();
    const controller = new AbortController();
    const reason = new Error('Owner stopped the request');

    const base = new MockLanguageModelV3({
      doStream: () => {
        requested.resolve();

        return new Promise(() => undefined);
      },
    });

    const pending = collect(
      withRequestRecovery(base, options, immediate),
      controller.signal,
    );

    const rejected = pending.catch((error: unknown) => error);
    await requested.promise;
    controller.abort(reason);
    expect(await rejected).toBe(reason);
  });

  it('cancels the source even before the first consumer read', async () => {
    const fixture = controlledModel();

    const result = await withRequestRecovery(
      fixture.model,
      options,
      immediate,
    ).doStream({ prompt: [] });

    const reason = new Error('Consumer detached');
    await result.stream.cancel(reason);

    expect(fixture.cancelled).toEqual([reason]);
  });

  it('stops a retry delay on cancellation without another provider send', async () => {
    const fixture = scriptedModel([overloaded(), complete]);
    const controller = new AbortController();
    const reason = new Error('Owner stopped the delay');

    const model = withRequestRecovery(fixture.model, {
      ...options,
      onRetry: () => {
        controller.abort(reason);
      },
    });

    await expect(collect(model, controller.signal)).rejects.toBe(reason);
    expect(fixture.sends()).toBe(1);
  });

  it('retries structured generation on the same model without stream windows', async () => {
    let sends = 0;

    const base = new MockLanguageModelV3({
      doGenerate: () => {
        sends += 1;

        return sends === 1
          ? Promise.reject(overloaded())
          : Promise.resolve({
              content: [{ type: 'text', text: 'Recovered title' }],
              finishReason: { unified: 'stop', raw: undefined },
              usage,
              warnings: [],
            });
      },
    });

    const result = await withRequestRecovery(
      base,
      options,
      immediate,
    ).doGenerate({ prompt: [] });

    expect(result.content).toEqual([{ type: 'text', text: 'Recovered title' }]);
    expect(sends).toBe(2);
  });

  it('stops structured generation at the shared eleven-send budget', async () => {
    let sends = 0;
    const retries: Array<number> = [];

    const base = new MockLanguageModelV3({
      doGenerate: () => {
        sends += 1;

        return Promise.reject(overloaded());
      },
    });

    await expect(
      withRequestRecovery(
        base,
        {
          ...options,
          onRetry: ({ retry }) => {
            retries.push(retry);
          },
        },
        immediate,
      ).doGenerate({ prompt: [] }),
    ).rejects.toMatchObject({ code: 'overloaded' });
    expect(sends).toBe(11);
    expect(retries).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('preserves owner cancellation during an unresponsive structured send', async () => {
    const requested = Promise.withResolvers<void>();
    const controller = new AbortController();
    const reason = new Error('Owner stopped the structured request');

    const base = new MockLanguageModelV3({
      doGenerate: () => {
        requested.resolve();

        return new Promise(() => {});
      },
    });

    const pending = withRequestRecovery(base, options).doGenerate({
      prompt: [],
      abortSignal: controller.signal,
    });

    const rejected = Promise.resolve(pending).catch((error: unknown) => error);

    await requested.promise;
    controller.abort(reason);

    expect(await rejected).toBe(reason);
  });

  it('cleans up the structured send window after a successful response', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;

    const base = new MockLanguageModelV3({
      doGenerate: (params) => {
        signal = params.abortSignal;

        return Promise.resolve({
          content: [{ type: 'text', text: 'Generated title' }],
          finishReason: { unified: 'stop', raw: undefined },
          usage,
          warnings: [],
        });
      },
    });

    await withRequestRecovery(base, options).doGenerate({ prompt: [] });

    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out and retries unresponsive structured sends with aborted signals', async () => {
    vi.useFakeTimers();
    let sends = 0;
    let aborts = 0;

    const base = new MockLanguageModelV3({
      doGenerate: ({ abortSignal }) => {
        sends += 1;

        return new Promise(() => {
          abortSignal?.addEventListener(
            'abort',
            () => {
              aborts += 1;
            },
            { once: true },
          );
        });
      },
    });

    const pending = withRequestRecovery(
      base,
      { ...options, firstTokenTimeoutSeconds: 1 },
      immediate,
    ).doGenerate({ prompt: [] });

    const rejected = Promise.resolve(pending).catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    expect(await rejected).toMatchObject({ code: 'first_token_timeout' });
    expect(sends).toBe(11);
    expect(aborts).toBe(11);
    expect(vi.getTimerCount()).toBe(0);
  });
});
