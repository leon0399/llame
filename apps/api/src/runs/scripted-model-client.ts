/**
 * The scripted model client backing `worker-harness.ts`: a `ModelClient`
 * double whose behavior is chosen per run (immediate completion, a delay, a
 * provider error, an infra throw, an indefinite hang that only reacts to
 * abort, or a conversation-recall tool-call script), plus the
 * `ModelSelectionValidator` double (`ScriptedModelsService`) that resolves it
 * by modelId. Split out of `worker-harness.ts` (which imports these names) so
 * each file stays under the size trip-wire on its own.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultOutput,
} from '@ai-sdk/provider';
import { stepCountIs, streamText as sdkStreamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

import type { ModelReasoning } from '../models/model-catalog';
import {
  resolveEffortSelection,
  type ModelSelectionValidator,
} from '../models/models.service';
import {
  awaitSettlementAfter,
  trackAbortSettlement,
  type AbortSettlement,
} from '../testing/fake-streaming-model-client';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';

const PROVIDER_ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/** Default for the scripted stream's `unblock` before a pending promise replaces it. */
function noop(): void {}

/**
 * The behavior a run's fake model client exhibits, keyed by modelId (each
 * seeded run picks its own modelId, so concurrently-executing runs can carry
 * different scripted behaviors without any call-order assumption).
 *
 * `infra-throw` simulates design D7/§9's "infrastructure failure" class
 * (credential resolution, a thrown handler): createClient() itself
 * throws a PLAIN Error — NOT ModelNotAvailableError/ModelConfigurationError,
 * which RunsWorkerService.executeJob special-cases into an immediate terminal
 * 'failed' with no retry. A plain throw propagates out of executeJob's try
 * block, which is exactly the queue-retries-it contract under test.
 */
export type ScriptedBehavior =
  | { kind: 'complete'; text?: string; delayMs?: number }
  | { kind: 'provider-error'; message?: string }
  | { kind: 'infra-throw'; message?: string }
  | { kind: 'hang' }
  | {
      kind: 'conversation-recall';
      query: string;
      continueRead?: boolean;
      finalText?: string;
    };

/** The subset `HarnessModelClient` actually streams; `infra-throw` never reaches it. */
type HarnessBehavior = Extract<
  ScriptedBehavior,
  | { kind: 'complete' }
  | { kind: 'provider-error' }
  | { kind: 'hang' }
  | { kind: 'conversation-recall' }
>;

type ConversationRecallBehavior = Extract<
  ScriptedBehavior,
  { kind: 'conversation-recall' }
>;

type ConversationCoordinates = {
  chatId: string;
  messageSeq: number;
  offset: number;
  limit: number;
};

const conversationSearchOutputSchema = z.object({
  status: z.literal('success'),
  results: z.array(
    z.object({
      kind: z.literal('content'),
      chatId: z.string().uuid(),
      messageSeq: z.number().int().positive(),
      offset: z.number().int().nonnegative(),
      limit: z.number().int().positive().max(2000),
    }),
  ),
});
const conversationReadOutputSchema = z.object({
  status: z.literal('success'),
  nextOffset: z.number().int().nonnegative().optional(),
});

function parseJsonText<T>(value: string, schema: z.ZodType<T>): T | undefined {
  try {
    const decoded: unknown = JSON.parse(value);
    const parsed = schema.safeParse(decoded);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Parses a `tool-result` content's output — JSON already, or JSON-as-text — against `schema`. */
function parseToolOutput<T>(
  output: LanguageModelV3ToolResultOutput,
  schema: z.ZodType<T>,
): T | undefined {
  if (output.type === 'json') {
    const parsed = schema.safeParse(output.value);
    return parsed.success ? parsed.data : undefined;
  }
  if (output.type === 'text') {
    return parseJsonText(output.value, schema);
  }
  return undefined;
}

function findSearchOutputs(prompt: LanguageModelV3CallOptions['prompt']) {
  const outputs: Array<z.output<typeof conversationSearchOutputSchema>> = [];
  for (const message of prompt) {
    if (message.role !== 'tool') continue;
    for (const content of message.content) {
      if (
        content.type !== 'tool-result' ||
        content.toolName !== 'search_conversations'
      )
        continue;
      const parsed = parseToolOutput(
        content.output,
        conversationSearchOutputSchema,
      );
      if (parsed !== undefined) outputs.push(parsed);
    }
  }
  return outputs;
}

function findReadOutputs(prompt: LanguageModelV3CallOptions['prompt']) {
  const outputs: Array<z.output<typeof conversationReadOutputSchema>> = [];
  for (const message of prompt) {
    if (message.role !== 'tool') continue;
    for (const content of message.content) {
      if (
        content.type !== 'tool-result' ||
        content.toolName !== 'conversation_read'
      )
        continue;
      const parsed = parseToolOutput(
        content.output,
        conversationReadOutputSchema,
      );
      if (parsed !== undefined) outputs.push(parsed);
    }
  }
  return outputs;
}

/** The canned text-only completion for a conversation-recall script's final turn. */
function finalRecallAnswerParts(
  text: string,
): Array<LanguageModelV3StreamPart> {
  return [
    { type: 'text-start', id: 'answer' },
    { type: 'text-delta', id: 'answer', delta: text },
    { type: 'text-end', id: 'answer' },
  ];
}

function conversationRecallParts(
  prompt: LanguageModelV3CallOptions['prompt'],
  behavior: ConversationRecallBehavior,
): Array<LanguageModelV3StreamPart> {
  const searchOutputs = findSearchOutputs(prompt);
  if (searchOutputs.length === 0) {
    return [
      {
        type: 'tool-call',
        toolCallId: 'conversation-search',
        toolName: 'search_conversations',
        input: JSON.stringify({ query: behavior.query, limit: 5 }),
      },
    ];
  }

  const readOutputs = findReadOutputs(prompt);
  const result = searchOutputs[0]?.results[0];
  const coordinates: ConversationCoordinates | undefined =
    result === undefined
      ? undefined
      : {
          chatId: result.chatId,
          messageSeq: result.messageSeq,
          offset: result.offset,
          limit: result.limit,
        };
  if (coordinates !== undefined && readOutputs.length === 0) {
    return [
      {
        type: 'tool-call',
        toolCallId: 'conversation-read-1',
        toolName: 'conversation_read',
        input: JSON.stringify(coordinates),
      },
    ];
  }

  const offset =
    behavior.continueRead && readOutputs.length === 1
      ? readOutputs[0]?.nextOffset
      : undefined;
  if (coordinates !== undefined && offset !== undefined) {
    return [
      {
        type: 'tool-call',
        toolCallId: 'conversation-read-2',
        toolName: 'conversation_read',
        input: JSON.stringify({ ...coordinates, offset, limit: 2 }),
      },
    ];
  }

  return finalRecallAnswerParts(behavior.finalText ?? 'The source was read.');
}

interface CancelableDelay {
  promise: Promise<void>;
  cancel: () => void;
}

/** A `setTimeout`-backed delay that `cancel()` can resolve (and clear) early. */
function cancelableDelay(ms: number): CancelableDelay {
  let timer: ReturnType<typeof setTimeout>;
  let resolveDelay: () => void = noop;
  const promise = new Promise<void>((resolve) => {
    resolveDelay = resolve;
    timer = setTimeout(resolve, ms);
  });
  return {
    promise,
    cancel: () => {
      clearTimeout(timer);
      resolveDelay();
    },
  };
}

/** Enqueues the canned event sequence for a completed plain-text answer. */
function enqueueAnswerParts(
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  text: string,
): void {
  controller.enqueue({ type: 'text-start', id: 'answer' });
  if (text.length > 0) {
    controller.enqueue({ type: 'text-delta', id: 'answer', delta: text });
  }
  controller.enqueue({ type: 'text-end', id: 'answer' });
  controller.enqueue({
    type: 'finish',
    finishReason: { unified: 'stop', raw: undefined },
    usage: PROVIDER_ZERO_USAGE,
  });
}

/** Enqueues the next scripted tool-call (or final answer) plus its finish event. */
function enqueueRecallParts(
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  prompt: LanguageModelV3CallOptions['prompt'],
  behavior: ConversationRecallBehavior,
): void {
  const parts = conversationRecallParts(prompt, behavior);
  for (const part of parts) {
    controller.enqueue(part);
  }
  controller.enqueue({
    type: 'finish',
    finishReason: {
      unified: parts.some((part) => part.type === 'tool-call')
        ? 'tool-calls'
        : 'stop',
      raw: undefined,
    },
    usage: PROVIDER_ZERO_USAGE,
  });
}

interface HangOrDelayGate {
  /** Resolves once the hang is released or the delay elapses. */
  wait: () => Promise<void>;
  /** Releases `wait()` early — bound to the stream's abort handler. */
  cancel: () => void;
}

/**
 * A `hang` behavior waits until `cancel()`d (only abort does that); a
 * `complete` behavior with `delayMs` waits out that delay, cancelable the
 * same way. Neither behavior yields a gate at all.
 */
function createHangOrDelayGate(
  behavior: HarnessBehavior,
  delayMs: number | undefined,
): HangOrDelayGate | undefined {
  if (behavior.kind === 'hang') {
    let unblock: () => void = noop;
    return {
      wait: () =>
        new Promise<void>((resolve) => {
          unblock = resolve;
        }),
      cancel: () => unblock(),
    };
  }
  if (delayMs) {
    const delay = cancelableDelay(delayMs);
    return { wait: () => delay.promise, cancel: delay.cancel };
  }
  return undefined;
}

/** Enqueues the scripted turn's completion — recall script or plain text — and closes the stream. */
function enqueueScriptedCompletion(
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  prompt: LanguageModelV3CallOptions['prompt'],
  behavior: HarnessBehavior,
  text: string,
): void {
  controller.enqueue({ type: 'stream-start', warnings: [] });
  if (behavior.kind === 'conversation-recall') {
    enqueueRecallParts(controller, prompt, behavior);
  } else {
    enqueueAnswerParts(controller, text);
  }
  controller.close();
}

/**
 * The abort- and delay/hang-aware stream backing a scripted turn: waits out a
 * `hang` indefinitely or a `complete` behavior's `delayMs` (if any), then
 * enqueues either the conversation-recall script's next part or the plain
 * completion text — unless `abortSignal` fires first.
 */
function createScriptedStream(options: {
  abortSignal: AbortSignal | undefined;
  prompt: LanguageModelV3CallOptions['prompt'];
  behavior: HarnessBehavior;
  text: string;
  delayMs: number | undefined;
}): ReadableStream<LanguageModelV3StreamPart> {
  const { abortSignal, prompt, behavior, text, delayMs } = options;
  return new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller) {
      const gate = createHangOrDelayGate(behavior, delayMs);
      const onAbort = () => {
        gate?.cancel();
        controller.error(new DOMException('Aborted', 'AbortError'));
      };
      if (abortSignal?.aborted) {
        onAbort();
        return;
      }
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      try {
        if (gate) {
          await gate.wait();
        }
        if (behavior.kind === 'hang' || abortSignal?.aborted) {
          return;
        }
        enqueueScriptedCompletion(controller, prompt, behavior, text);
      } catch (error) {
        controller.error(error);
      } finally {
        abortSignal?.removeEventListener('abort', onAbort);
      }
    },
  });
}

/** Forwards tool options, plus the conversation-recall step cap, exactly as offered. */
function resolveHarnessStreamOptions(
  input: ModelStreamInput,
  behavior: HarnessBehavior,
): Pick<
  Parameters<typeof sdkStreamText>[0],
  'tools' | 'toolChoice' | 'stopWhen'
> {
  if (!input.tools) return {};
  return {
    tools: input.tools,
    ...(input.toolChoice !== undefined && { toolChoice: input.toolChoice }),
    ...(behavior.kind === 'conversation-recall' && {
      stopWhen: stepCountIs((input.maxSteps ?? 8) + 1),
    }),
  };
}

/** The `streamText` event handlers backing a scripted turn. */
function scriptedStreamHandlers(
  input: ModelStreamInput,
  settlement: AbortSettlement,
): Pick<
  Parameters<typeof sdkStreamText>[0],
  'onChunk' | 'onError' | 'onAbort' | 'onFinish'
> {
  return {
    onChunk: ({ chunk }) => {
      if (chunk.type === 'text-delta') {
        input.onTextDelta?.(chunk.text);
      } else if (chunk.type === 'reasoning-delta') {
        input.onReasoningDelta?.(chunk.text, chunk.id);
      }
    },
    onError: input.onError,
    onAbort: settlement.onAbort,
    onFinish: ({ text: response, usage, finishReason }) =>
      input.onFinish?.({ text: response, usage, finishReason }),
  };
}

class HarnessModelClient implements ModelClient {
  readonly provider = 'fake';
  readonly contextWindowTokens = 128_000;

  constructor(
    readonly model: string,
    private readonly behavior: HarnessBehavior,
    /** Shared with the owning ScriptedModelsService so a test can assert what execution actually requested. */
    private readonly streamCalls: Array<{
      modelId: string;
      effort: string | undefined;
    }> = [],
  ) {}

  streamText(input: ModelStreamInput): ReturnType<typeof sdkStreamText> {
    this.streamCalls.push({ modelId: this.model, effort: input.effort });
    const behavior = this.behavior;
    const text = behavior.kind === 'complete' ? (behavior.text ?? 'ok') : '';
    const delayMs = behavior.kind === 'complete' ? behavior.delayMs : undefined;
    const settlement = trackAbortSettlement(input);

    const model = new MockLanguageModelV3({
      provider: 'fake',
      modelId: this.model,
      doStream: ({ abortSignal, prompt }) => {
        if (behavior.kind === 'provider-error') {
          return Promise.reject(
            new Error(behavior.message ?? 'simulated provider failure'),
          );
        }
        return Promise.resolve({
          stream: createScriptedStream({
            abortSignal,
            prompt,
            behavior,
            text,
            delayMs,
          }),
        });
      },
    });

    const result = sdkStreamText({
      model,
      messages: input.messages,
      system: input.system,
      abortSignal: input.abortSignal,
      ...resolveHarnessStreamOptions(input, behavior),
      ...scriptedStreamHandlers(input, settlement),
    });

    return awaitSettlementAfter(result, settlement);
  }
}

/**
 * ModelsService double whose behavior is scripted PER RUN via its modelId —
 * seed a run with a unique modelId, `register()` its behavior before
 * dispatching, and RunsWorkerService.executeJob's `createClient(modelId)`
 * call resolves to it deterministically regardless of which order
 * concurrent jobs actually get claimed in.
 */
/**
 * `implements ModelSelectionValidator` is load-bearing: the harness injects
 * this by Nest override, which is not structurally typechecked, so a method
 * added to the narrow contract would otherwise fail at run time rather than at
 * compile time.
 */
export class ScriptedModelsService implements ModelSelectionValidator {
  private readonly behaviors = new Map<string, ScriptedBehavior>();
  readonly createClientCalls: Array<{ modelId: string }> = [];
  /** Every streamText the executor issued, with the effort it carried. */
  readonly streamCalls: Array<{ modelId: string; effort: string | undefined }> =
    [];

  register(modelId: string, behavior: ScriptedBehavior): void {
    this.behaviors.set(modelId, behavior);
  }

  /** Per-model reasoning vocabulary a test declares before sending. */
  private readonly reasoning = new Map<string, ModelReasoning>();

  registerReasoning(modelId: string, reasoning: ModelReasoning): void {
    this.reasoning.set(modelId, reasoning);
  }

  validateModelSelection(modelId: string) {
    const reasoning = this.reasoning.get(modelId);
    return {
      id: modelId,
      source: 'system' as const,
      contextWindowTokens: 128_000,
      provider: 'openai',
      providerModelId: modelId,
      systemPromptTemplate: `Harness prompt for ${modelId}`,
      systemPromptSource: 'project_default' as const,
      ...(reasoning !== undefined && { reasoning }),
    };
  }

  /**
   * Delegates to the production resolver rather than restating its rules, so a
   * change to effort semantics cannot pass the integration tests while the API
   * behaves differently.
   */
  resolveEffortSelection(
    model: Parameters<typeof resolveEffortSelection>[0],
    requested: string | undefined,
  ): string | undefined {
    return resolveEffortSelection(model, requested);
  }

  resolveTitleModelConfig() {
    return {
      id: 'system:openai:gpt-5.4-nano',
      source: 'system' as const,
      provider: 'openai',
      providerModelId: 'gpt-5.4-nano',
    };
  }

  createClient(modelId: string): ModelClient {
    this.createClientCalls.push({ modelId });
    const behavior = this.behaviors.get(modelId);
    if (!behavior) {
      throw new Error(
        `ScriptedModelsService: no behavior registered for modelId "${modelId}"`,
      );
    }
    if (behavior.kind === 'infra-throw') {
      throw new Error(
        behavior.message ?? `simulated infra failure for ${modelId}`,
      );
    }
    return new HarnessModelClient(modelId, behavior, this.streamCalls);
  }
}
