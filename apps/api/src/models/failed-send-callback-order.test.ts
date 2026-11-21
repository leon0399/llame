/**
 * The production callback order for a Run step whose send streams a complete
 * `tool-call` part and then fails while the call it started still runs
 * (continuing a Run after a broken send, tasks.md 2.1). The continuation
 * design reads the failure at the `error` part and decides in `onFinish`, so
 * it rests on this order; the fake model client hides it by calling `onError`
 * at once.
 *
 * Both real client shapes are driven through their own dependency seam with
 * `applyRequestRecovery` active: the Responses client through
 * `runStreamChannel` (deferred terminal callbacks behind its one `fullStream`
 * consumer) and the Chat Completions client (none). Only the transport is
 * stubbed; `streamText`, step scheduling, tool execution, and the recovery
 * wrapper are the SDK's.
 */

import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { OpenAIProvider } from '@ai-sdk/openai';
import type { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  simulateReadableStream,
  streamText,
  tool,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

import type {
  ChatIdentity,
  ModelStreamInput,
  ModelStreamResult,
} from './model-client';
import {
  createOpenAICompletionsModelClient,
  type OpenAICompletionsModelClientDependencies,
} from './openai-completions-model-client';
import {
  createOpenAIModelClient,
  type OpenAIModelClientDependencies,
} from './openai-model-client';
import { ProviderFailure } from './provider-failure/provider-failure';

const CHAT: ChatIdentity = { id: 'callback-order', lane: 'main' };

const MESSAGES = [
  { role: 'user', content: 'Use the slow tool, then answer.' },
] satisfies Array<ModelMessage>;

/** The product token llame's boot-read identity supplies to every client. */
const USER_AGENT = 'llame/0.0.0-test';

/** The text the broken send streamed after its complete call. */
const TRAILING_TEXT = 'Trailing text after the call.';

/** The reason a Run stop aborts its call with (`RunAbortRegistry`). */
const STOP_REASON = 'run-stopped';

/**
 * The owner interrupt's signal reason (`INTERRUPT_ABORT_REASON` in
 * `runs/run-abort-registry.ts`): what a Run's call signal carries when an
 * interrupt aborts its segment.
 */
const INTERRUPT_REASON = 'owner-interrupt';

const PROVIDER_USAGE = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

const FAILED_SEND_PARTS: Array<LanguageModelV3StreamPart> = [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 'answer' },
  { type: 'text-delta', id: 'answer', delta: 'Before the call. ' },
  {
    type: 'tool-call',
    toolCallId: 'call-1',
    toolName: 'slow_tool',
    input: '{"value":"x"}',
  },
  { type: 'text-delta', id: 'answer', delta: TRAILING_TEXT },
  { type: 'text-end', id: 'answer' },
  { type: 'error', error: new Error('the provider stream broke') },
];

const FINISHED_SEND_PARTS: Array<LanguageModelV3StreamPart> = [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 'answer' },
  { type: 'text-delta', id: 'answer', delta: 'Recovered answer.' },
  { type: 'text-end', id: 'answer' },
  {
    type: 'finish',
    finishReason: { unified: 'stop', raw: undefined },
    usage: PROVIDER_USAGE,
  },
];

type ClientWire = 'responses' | 'completions';

type TimelineEntry = {
  readonly name: string;
  readonly detail?: string;
};

/** Callback and stream events of one request, in the order they ran. */
class Timeline {
  private readonly entries: Array<TimelineEntry> = [];

  record(name: string, detail?: string): void {
    this.entries.push({
      name,
      ...(detail !== undefined && { detail }),
    });
  }

  occurred(name: string): boolean {
    return this.entries.some((entry) => entry.name === name);
  }

  /** The observed events, in order, `name` or `name:detail`. */
  summary(): Array<string> {
    return this.entries.map((entry) =>
      entry.detail === undefined ? entry.name : `${entry.name}:${entry.detail}`,
    );
  }
}

/** One readable description of what the callbacks received. */
function describeFailure(error: unknown): string {
  if (error instanceof ProviderFailure) return error.code;

  if (error instanceof Error) return `${error.name}: ${error.message}`;

  return String(error);
}

function providerFailureOf(error: unknown): ProviderFailure {
  if (!(error instanceof ProviderFailure))
    throw new TypeError(
      `Expected a ProviderFailure, received ${String(error)}`,
    );

  return error;
}

/**
 * Real time on purpose: the provider's own `simulateReadableStream` and the
 * recovery's stream windows are driven by real timers, so fake timers would
 * have to be advanced in step with every awaited read. The 50 ms only keeps
 * the call pending while the failure is reported; the order asserted below
 * never depends on its exact length.
 */
function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);

  return promise;
}

/**
 * The SDK's terminal callbacks as the client left them, recorded on entry. The
 * wrapper the SDK calls first is the client's own outermost handler: the
 * `captureRequestFailure` one on both clients.
 */
function recordingStreamText(
  timeline: Timeline,
  recordCapture: (error: unknown) => void,
): OpenAIModelClientDependencies['streamText'] {
  return (options) => {
    const sdkOnError = options.onError;

    options.onError = (event) => {
      timeline.record('sdk.onError-entry');
      recordCapture(event.error);
      const settled = sdkOnError?.(event);
      timeline.record('sdk.onError-returned');

      return settled;
    };

    const sdkOnAbort = options.onAbort;

    options.onAbort = (event) => {
      timeline.record('sdk.onAbort-entry');

      return sdkOnAbort?.(event);
    };

    const sdkOnFinish = options.onFinish;

    options.onFinish = (event) => {
      timeline.record('sdk.onFinish-entry');

      return sdkOnFinish?.(event);
    };

    return streamText(options);
  };
}

/** A transcript of the order `slow_tool` runs in. */
function slowTool(timeline: Timeline, settlement: Promise<string>): ToolSet {
  return {
    slow_tool: tool({
      inputSchema: z.strictObject({ value: z.string() }),
      execute: async () => {
        timeline.record('tool.started');
        const output = await settlement;
        timeline.record('tool.settled');

        return output;
      },
    }),
  };
}

function scriptedModel(timeline: Timeline): MockLanguageModelV3 {
  let sends = 0;

  return new MockLanguageModelV3({
    provider: 'callback-order.test',
    modelId: 'callback-order-model',
    doStream: () => {
      sends += 1;
      timeline.record('doStream', String(sends));

      return Promise.resolve({
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: sends === 1 ? FAILED_SEND_PARTS : FINISHED_SEND_PARTS,
          chunkDelayInMs: 0,
        }),
      });
    },
  });
}

// Test seam (anti-slop/no-module-mocking): the Chat Completions client's
// provider factory is replaced at its dependency seam, never module-mocked.
const createOpenAICompatibleMock = vi.mocked(
  vi.fn<typeof createOpenAICompatible>(),
  { partial: true },
);

function completionsClient(
  model: MockLanguageModelV3,
  streamTextDependency: OpenAICompletionsModelClientDependencies['streamText'],
) {
  const provider = Object.assign(
    vi.fn(() => model),
    {
      chatModel: vi.fn(() => model),
    },
  );

  createOpenAICompatibleMock.mockReturnValue(provider);

  return createOpenAICompletionsModelClient(
    {
      credential: 'sk-test',
      providerModelId: 'callback-order-model',
      modelId: 'system:callback-order:model',
      contextWindowTokens: 128_000,
      userAgent: USER_AGENT,
      requestHeaders: {},
      baseUrl: 'https://callback-order.example.test/v1',
    },
    {
      createOpenAICompatible: createOpenAICompatibleMock,
      streamText: streamTextDependency,
    },
  );
}

function responsesClient(
  model: MockLanguageModelV3,
  streamTextDependency: OpenAIModelClientDependencies['streamText'],
) {
  const provider = vi.fn<OpenAIProvider>();
  provider.mockReturnValue(model);

  return createOpenAIModelClient(
    {
      providerModelId: 'callback-order-model',
      modelId: 'system:callback-order:model',
      contextWindowTokens: 128_000,
      userAgent: USER_AGENT,
      requestHeaders: {},
    },
    { createOpenAI: () => provider, streamText: streamTextDependency },
  );
}

type Harness = {
  readonly timeline: Timeline;
  readonly model: MockLanguageModelV3;
  readonly result: ModelStreamResult;
  readonly reportedErrors: Array<unknown>;
  readonly finishEvents: Array<{ finishReason: string; stepCount: number }>;
  readonly captureEntry: Promise<unknown>;
  readonly settleTool: (output: string) => void;
};

type HarnessOptions = {
  readonly clientWire: ClientWire;
  readonly abortSignal?: AbortSignal;
  readonly stopWhenExtra?: () => Promise<boolean>;
};

/**
 * One client, one mock model, and the input a Run builds: a tool whose
 * `execute` settles only from the test, plus the seam callbacks the order is
 * read from.
 */
function startHarness(options: HarnessOptions): Harness {
  const timeline = new Timeline();
  const toolSettlement = Promise.withResolvers<string>();
  const captureEntry = Promise.withResolvers<unknown>();
  const reportedErrors: Array<unknown> = [];
  const finishEvents: Array<{ finishReason: string; stepCount: number }> = [];

  const model = scriptedModel(timeline);

  const streamTransaction = recordingStreamText(timeline, (error) =>
    captureEntry.resolve(error),
  );

  const input: ModelStreamInput = {
    chat: CHAT,
    messages: MESSAGES,
    tools: slowTool(timeline, toolSettlement.promise),
    ...(options.abortSignal !== undefined && {
      abortSignal: options.abortSignal,
    }),
    ...(options.stopWhenExtra !== undefined && {
      stopWhenExtra: options.stopWhenExtra,
    }),
    onTextDelta: (text) => {
      if (text.length > 0) timeline.record('text', text);
    },
    onToolCall: (call) => timeline.record('tool-call', call.toolName),
    onStepStart: (step) => {
      timeline.record('step', String(step.stepNumber + 1));

      return undefined;
    },
    onError: ({ error }) => {
      reportedErrors.push(error);
      timeline.record('input.onError', describeFailure(error));
    },
    onSendFailed: (failure) => {
      timeline.record('input.onSendFailed', describeFailure(failure));
    },
    onFinish: (event) => {
      finishEvents.push({
        finishReason: event.finishReason,
        stepCount: event.stepCount,
      });
      timeline.record(
        'input.onFinish',
        `${event.finishReason}:${String(event.stepCount)}`,
      );
    },
  };

  const client =
    options.clientWire === 'responses'
      ? responsesClient(model, streamTransaction)
      : completionsClient(model, streamTransaction);

  const result = client.streamText(input);

  return {
    timeline,
    model,
    result,
    reportedErrors,
    finishEvents,
    captureEntry: captureEntry.promise,
    settleTool: (output: string) => toolSettlement.resolve(output),
  };
}

/** Starts the one consumption a Run performs, without awaiting it. */
function consume(result: ModelStreamResult) {
  const consumption = result.consumeStream();

  return {
    consumption,
    textSettled: result.text.then(
      () => 'fulfilled' as const,
      () => 'rejected' as const,
    ),
  };
}

/**
 * Every case opens on the same step-1 head, on either client. `onSendFailed`
 * runs at the `error` part, before the SDK's own deferred `onError`, and so
 * before the call it started can settle: that is the seam the continuation
 * reads.
 */
const STEP_ONE_HEAD: ReadonlyArray<string> = [
  'step:1',
  'doStream:1',
  'text:Before the call. ',
  'tool-call:slow_tool',
  'tool.started',
  `text:${TRAILING_TEXT}`,
  'sdk.onError-entry',
  'input.onSendFailed:stream_broken',
  'sdk.onError-returned',
];

/** The failure every callback sees for the send that broke on its call. */
const BROKEN_SEND_FAILURE = 'input.onError:stream_broken';

/**
 * The observed order when nothing stops the call: the SDK keeps the failed
 * step open until the call settles, then sends step 2, and `onFinish` runs
 * once after the loop. The Responses client defers the failure report behind
 * its stream consumer; the Chat Completions client reports it at the `error`
 * part, while the call still runs.
 */
function continuingOrder(clientWire: ClientWire): Array<string> {
  return clientWire === 'responses'
    ? [
        ...STEP_ONE_HEAD,
        'tool.settled',
        'step:2',
        'doStream:2',
        'text:Recovered answer.',
        'sdk.onFinish-entry',
        BROKEN_SEND_FAILURE,
        'input.onFinish:stop:2',
      ]
    : [
        ...STEP_ONE_HEAD,
        BROKEN_SEND_FAILURE,
        'tool.settled',
        'step:2',
        'doStream:2',
        'text:Recovered answer.',
        'sdk.onFinish-entry',
        'input.onFinish:stop:2',
      ];
}

/** The observed order when the call signal aborts during the wait. */
function abortedOrder(clientWire: ClientWire, reason: string): Array<string> {
  return clientWire === 'responses'
    ? [
        ...STEP_ONE_HEAD,
        'tool.settled',
        'sdk.onAbort-entry',
        BROKEN_SEND_FAILURE,
        `input.onError:${reason}`,
      ]
    : [
        ...STEP_ONE_HEAD,
        BROKEN_SEND_FAILURE,
        'tool.settled',
        'sdk.onAbort-entry',
        `input.onError:${reason}`,
      ];
}

/** The observed order when `stopWhenExtra` ends the loop at the failed step. */
function stoppedOrder(clientWire: ClientWire): Array<string> {
  return clientWire === 'responses'
    ? [
        ...STEP_ONE_HEAD,
        'tool.settled',
        'sdk.onFinish-entry',
        BROKEN_SEND_FAILURE,
        'input.onFinish:error:1',
      ]
    : [
        ...STEP_ONE_HEAD,
        BROKEN_SEND_FAILURE,
        'tool.settled',
        'sdk.onFinish-entry',
        'input.onFinish:error:1',
      ];
}

describe.each<ClientWire>(['responses', 'completions'])(
  '%s wire: a send that breaks after its complete tool call',
  (clientWire) => {
    it('waits for the call, then sends step 2 with its text', async () => {
      const harness = startHarness({ clientWire });
      const running = consume(harness.result);

      await harness.captureEntry;
      expect(harness.timeline.occurred('tool.settled')).toBe(false);

      await delay(50);
      harness.settleTool('slow output');
      await running.consumption;
      await running.textSettled;

      expect(harness.timeline.summary()).toEqual(continuingOrder(clientWire));
      expect(providerFailureOf(harness.reportedErrors[0]).code).toBe(
        'stream_broken',
      );
      // C4: once, after the whole loop.
      expect(harness.finishEvents).toEqual([
        { finishReason: 'stop', stepCount: 2 },
      ]);
      // C3: a second send happens, and its prompt carries the broken send's
      // trailing text and the settled call's output.
      expect(harness.model.doStreamCalls).toHaveLength(2);

      const secondPrompt = JSON.stringify(
        harness.model.doStreamCalls[1]?.prompt,
      );

      expect(secondPrompt).toContain(TRAILING_TEXT);
      expect(secondPrompt).toContain('slow output');
    });

    it('reports a stop during the wait, not in onFinish', async () => {
      const abort = new AbortController();
      const harness = startHarness({ clientWire, abortSignal: abort.signal });
      const running = consume(harness.result);

      await harness.captureEntry;
      abort.abort(STOP_REASON);
      await delay(50);
      harness.settleTool('slow output');
      await running.consumption;

      expect(await running.textSettled).toBe('rejected');
      expect(harness.timeline.summary()).toEqual(
        abortedOrder(clientWire, STOP_REASON),
      );
      // The failure still reaches the run's handler, then the stop's own
      // reason does; neither ends in `onFinish`.
      expect(providerFailureOf(harness.reportedErrors[0]).code).toBe(
        'stream_broken',
      );
      expect(harness.reportedErrors[1]).toBe(STOP_REASON);
      expect(harness.timeline.occurred('sdk.onFinish-entry')).toBe(false);
      expect(harness.finishEvents).toEqual([]);
      expect(harness.model.doStreamCalls).toHaveLength(1);
    });

    it('runs an owner interrupt through the same path', async () => {
      const runAbort = new AbortController();
      const segmentAbort = new AbortController();

      const harness = startHarness({
        clientWire,
        abortSignal: AbortSignal.any([runAbort.signal, segmentAbort.signal]),
      });

      const running = consume(harness.result);

      await harness.captureEntry;
      segmentAbort.abort(INTERRUPT_REASON);
      await delay(50);
      harness.settleTool('slow output');
      await running.consumption;

      expect(await running.textSettled).toBe('rejected');
      // The client has no interrupt-only path: the combined call signal aborts
      // like a stop, and only its reason differs.
      expect(harness.timeline.summary()).toEqual(
        abortedOrder(clientWire, INTERRUPT_REASON),
      );
      expect(harness.reportedErrors[1]).toBe(INTERRUPT_REASON);
      expect(harness.timeline.occurred('sdk.onFinish-entry')).toBe(false);
      expect(harness.model.doStreamCalls).toHaveLength(1);
      // The Run's own signal never aborted: only the call's segment did.
      expect(runAbort.signal.aborted).toBe(false);
    });

    it('sends no second request when the hook stops the loop', async () => {
      const stopWhenExtra = vi.fn(() => Promise.resolve(true));
      const harness = startHarness({ clientWire, stopWhenExtra });
      const running = consume(harness.result);

      await harness.captureEntry;
      await delay(50);
      harness.settleTool('slow output');
      await running.consumption;
      await running.textSettled;

      expect(stopWhenExtra).toHaveBeenCalledTimes(1);
      expect(harness.timeline.summary()).toEqual(stoppedOrder(clientWire));
      // C5: the SDK asks the hook once, at the failed step's end, and sends
      // nothing more.
      expect(harness.model.doStreamCalls).toHaveLength(1);
      expect(harness.finishEvents).toEqual([
        { finishReason: 'error', stepCount: 1 },
      ]);
    });
  },
);
