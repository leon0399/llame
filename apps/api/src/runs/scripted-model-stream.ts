/**
 * The stream a scripted turn delivers: the abort-, delay-, and hang-aware
 * `ReadableStream` `HarnessModelClient` hands the SDK, plus the part builders
 * for each scripted behavior (plain completion text, a tool call, the recall
 * script's next part, or a whole provider step). Split out of
 * `scripted-model-client.ts` so that file stays under the size trip-wire.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

import { conversationRecallParts } from './scripted-model-recall';
import {
  PROVIDER_ZERO_USAGE,
  stepHold,
  scriptedStepParts,
  scriptedToolInput,
  type ScriptedStep,
} from './scripted-model-step';
import type { ScriptedBehavior } from './scripted-model-client';

/** Default for the scripted stream's `unblock` before a pending promise replaces it. */
function noop(): void {}

/** The subset `HarnessModelClient` actually streams; `infra-throw` never reaches it. */
export type HarnessBehavior = Exclude<
  ScriptedBehavior,
  { kind: 'infra-throw' }
>;

/** The behavior that scripts one recall step at a time from the prompt. */
export type ConversationRecallBehavior = Extract<
  ScriptedBehavior,
  { kind: 'conversation-recall' }
>;

interface CancelableDelay {
  promise: Promise<void>;
  cancel: () => void;
}

/** A `setTimeout`-backed delay that `cancel()` can resolve (and clear) early. */
function cancelableDelay(ms: number): CancelableDelay {
  const { promise, resolve: resolveDelay } = Promise.withResolvers<void>();

  const timer = setTimeout(resolveDelay, ms);

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
      wait: () => {
        const { promise, resolve } = Promise.withResolvers<void>();

        unblock = resolve;

        return promise;
      },
      cancel: () => unblock(),
    };
  }

  if (delayMs) {
    const delay = cancelableDelay(delayMs);

    return { wait: () => delay.promise, cancel: delay.cancel };
  }

  return undefined;
}

/** Everything one `createScriptedStream` call serves: the behavior and step to deliver. */
export interface ScriptedStreamOptions {
  abortSignal: AbortSignal | undefined;
  prompt: LanguageModelV3CallOptions['prompt'];
  behavior: HarnessBehavior;
  delayMs: number | undefined;
  scriptedStep: ScriptedStep | undefined;
  usage: LanguageModelV3Usage | undefined;
}

/**
 * Enqueues the scripted turn's delivery — a whole provider step, a tool call,
 * the recall script's next part, or plain text — and closes the stream.
 * Returns whether the stream stays open instead.
 */
function enqueueScriptedCompletion(
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  options: ScriptedStreamOptions,
): boolean {
  const { prompt, behavior, scriptedStep, usage } = options;

  controller.enqueue({ type: 'stream-start', warnings: [] });

  if (behavior.kind === 'step-script') {
    if (scriptedStep === undefined) {
      enqueueAnswerParts(controller, '');
    } else {
      for (const part of scriptedStepParts(scriptedStep)) {
        controller.enqueue(
          part.type === 'finish' && usage !== undefined
            ? { ...part, usage }
            : part,
        );
      }
    }
  } else if (behavior.kind === 'tool-script') {
    enqueueToolScript(controller, prompt, behavior);
  } else if (behavior.kind === 'conversation-recall') {
    enqueueRecallParts(controller, prompt, behavior);
  } else {
    enqueueAnswerParts(
      controller,
      behavior.kind === 'complete' ? (behavior.text ?? 'ok') : '',
    );
  }

  // A step with a `hold` keeps the stream open for the abort to end.
  const hold = scriptedStep === undefined ? undefined : stepHold(scriptedStep);

  if (hold !== undefined) {
    hold.onHeld?.();

    return true;
  }

  controller.close();

  return false;
}

function enqueueToolScript(
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  prompt: LanguageModelV3CallOptions['prompt'],
  behavior: Extract<ScriptedBehavior, { kind: 'tool-script' }>,
): void {
  const completed = new Set<string>();

  for (const message of prompt) {
    if (message.role !== 'tool') continue;

    for (const part of message.content) {
      if (part.type === 'tool-result') completed.add(part.toolCallId);
    }
  }

  const next = behavior.calls.find((call) => !completed.has(call.id));

  if (!next) {
    enqueueAnswerParts(controller, behavior.finalText);

    return;
  }

  controller.enqueue({
    type: 'tool-call',
    toolCallId: next.id,
    toolName: next.name,
    input: scriptedToolInput(next.name, next.input),
  });
  controller.enqueue({
    type: 'finish',
    finishReason: { unified: 'tool-calls', raw: undefined },
    usage: PROVIDER_ZERO_USAGE,
  });
}

/**
 * The abort- and delay/hang-aware stream backing a scripted turn: waits out a
 * `hang` indefinitely or a `complete` behavior's `delayMs` (if any), then
 * enqueues the behavior's scripted delivery (a whole provider step, a tool
 * call, the recall script's next part, or the plain completion text) — unless
 * `abortSignal` fires first.
 */
export function createScriptedStream(
  options: ScriptedStreamOptions,
): ReadableStream<LanguageModelV3StreamPart> {
  const { abortSignal, behavior, delayMs } = options;

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

      let holding = false;

      try {
        if (gate) {
          await gate.wait();
        }

        if (behavior.kind === 'hang' || abortSignal?.aborted) {
          return;
        }

        holding = enqueueScriptedCompletion(controller, options);
      } catch (error) {
        controller.error(error);
      } finally {
        // A held stream keeps listening: only the abort ends it.
        if (!holding) abortSignal?.removeEventListener('abort', onAbort);
      }
    },
  });
}
