import { type UnknownRecord } from '@workspace/runtime-safety';

/**
 * The scripted model client backing `worker-harness.ts`: a `ModelClient`
 * double whose behavior is chosen per run (immediate completion, a delay, a
 * provider error, an infra throw, an indefinite hang that only reacts to
 * abort, a conversation-recall tool-call script, or a whole provider step with
 * reasoning, text, parallel calls, metadata, refusals, and a stream error),
 * plus the `ModelSelectionValidator` double (`ScriptedModelsService`) that
 * resolves it by modelId. Split out of `worker-harness.ts` (which imports these
 * names) so each file stays under the size trip-wire on its own.
 */

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { streamText as sdkStreamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';

import type { ModelInput, ModelReasoning } from '../models/model-catalog';
import {
  installStepPreparation,
  toolLoopStopWhen,
} from '../models/step-composer';
import { applyRequestUsageCallback } from '../models/request-usage';
import {
  resolveEffortSelection,
  type ModelSelectionValidator,
} from '../models/models.service';
import {
  awaitSettlementAfter,
  trackAbortSettlement,
} from '../testing/fake-streaming-model-client';
import {
  applyToolCallingOptions,
  runStreamChannel,
} from '../models/openai-model-client';
import type { ModelClient, ModelStreamInput } from '../models/model-client';
import { createToolCallGate } from '../models/tool-call-gate';
import { scriptedStreamHandlers } from './scripted-model-stream-options';
import { conversationRecallParts } from './scripted-model-recall';
import {
  PROVIDER_ZERO_USAGE,
  stepHold,
  scriptedStepParts,
  type ScriptedStep,
} from './scripted-model-step';
import {
  providerDeclarations,
  type ScriptedModelRecords,
  type StreamCallRecord,
  type ToolDeclarationRecord,
} from './scripted-model-records';

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
export type ScriptedBehavior = {
  /**
   * Whether this model's system prompt references the `skills` namespace, so
   * `resolveTurnSkillState` bakes and renders the catalog baseline (a
   * Machine Workspace's skill must be provably offered in the prompt). False
   * unless a test opts in, matching every production model.
   */
  readonly referencesSkills?: boolean;
  /**
   * The model's `compactionThresholdTokens`, so a test reaches the pre-step
   * compaction trigger without a 100,000-token history. Absent keeps the
   * production default.
   */
  readonly compactionThresholdTokens?: number;
} & (
  | { kind: 'complete'; text?: string; delayMs?: number }
  | { kind: 'provider-error'; message?: string }
  | { kind: 'infra-throw'; message?: string }
  | { kind: 'hang' }
  | {
      kind: 'tool-script';
      calls: ReadonlyArray<{ id: string; name: string; input: UnknownRecord }>;
      finalText: string;
    }
  | {
      kind: 'conversation-recall';
      query: string;
      continueRead?: boolean;
      finalText?: string;
    }
  | {
      /**
       * One entry per provider request, in the order the SDK makes them: the
       * real `streamText` builds the next step's messages itself, so a step
       * sees exactly the tool results the previous one produced.
       *
       * The script restarts at step 0 for every Run: `createClient` runs on
       * each job pickup, so a test scripting a second turn on the same model
       * must `register()` that script again before dispatching it. A Run that
       * exhausts its script answers with empty text.
       */
      kind: 'step-script';
      steps: ReadonlyArray<ScriptedStep>;
      /** Usage reported by each provider request, indexed by scripted step. */
      requestUsages?: ReadonlyArray<LanguageModelV3Usage>;
      /**
       * Runs while the model responds to step `stepIndex` (counted across the
       * Run's segments), before that step's stream opens: a test stores a
       * pending steer or records a cancellation at a deterministic moment.
       */
      beforeStep?: (stepIndex: number) => Promise<void> | void;
    }
);

/** The subset `HarnessModelClient` actually streams; `infra-throw` never reaches it. */
type HarnessBehavior = Exclude<ScriptedBehavior, { kind: 'infra-throw' }>;

type ConversationRecallBehavior = Extract<
  ScriptedBehavior,
  { kind: 'conversation-recall' }
>;

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

/**
 * Enqueues the scripted turn's delivery — a whole provider step, a tool call,
 * the recall script's next part, or plain text — and closes the stream.
 * Returns whether the stream stays open instead.
 */
function enqueueScriptedCompletion(
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  options: Parameters<typeof createScriptedStream>[0],
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
    input: JSON.stringify(next.input),
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
function createScriptedStream(options: {
  abortSignal: AbortSignal | undefined;
  prompt: LanguageModelV3CallOptions['prompt'];
  behavior: HarnessBehavior;
  delayMs: number | undefined;
  scriptedStep: ScriptedStep | undefined;
  usage: LanguageModelV3Usage | undefined;
}): ReadableStream<LanguageModelV3StreamPart> {
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

class HarnessModelClient implements ModelClient {
  readonly provider = 'fake';
  readonly contextWindowTokens = 128_000;
  readonly compactionThresholdTokens?: number;
  /** The provider request the next `doStream` serves, for a step script. */
  private scriptedStepIndex = 0;

  constructor(
    readonly model: string,
    private readonly behavior: HarnessBehavior,
    /**
     * Shared with the owning ScriptedModelsService so a test can assert what
     * execution actually requested and which provider prompts it sent.
     */
    private readonly recorded: ScriptedModelRecords,
    readonly input: ReadonlyArray<ModelInput>,
  ) {
    if (behavior.compactionThresholdTokens !== undefined) {
      this.compactionThresholdTokens = behavior.compactionThresholdTokens;
    }
  }

  streamText(input: ModelStreamInput): ReturnType<typeof sdkStreamText> {
    this.recorded.streamCalls.push({
      modelId: this.model,
      effort: input.effort,
      chat: input.chat,
    });
    const behavior = this.behavior;
    const delayMs = behavior.kind === 'complete' ? behavior.delayMs : undefined;
    const settlement = trackAbortSettlement(input);
    // A whole-step script is the one behavior that exercises the production
    // stream channel: `onChunk` cannot see a part's start or end, so its text
    // metadata and ordering would never reach the run.
    const wholeStep = behavior.kind === 'step-script';

    const model = new MockLanguageModelV3({
      provider: 'fake',
      modelId: this.model,
      doStream: async ({ abortSignal, prompt, tools }) => {
        this.recorded.prompts.push(prompt);
        // Per provider call, not per attempt: a Workspace MCP server's tools
        // join the tool set after the entry step ran, so only the step that
        // followed the call carries them.
        this.recorded.declarations.push({
          modelId: this.model,
          tools: providerDeclarations(tools),
        });

        if (behavior.kind === 'provider-error') {
          throw new Error(behavior.message ?? 'simulated provider failure');
        }

        const stepIndex = this.scriptedStepIndex;

        const scriptedStep =
          behavior.kind === 'step-script'
            ? behavior.steps[this.scriptedStepIndex++]
            : undefined;

        // The hook runs while the model "responds": before its stream opens.
        if (behavior.kind === 'step-script') {
          await behavior.beforeStep?.(stepIndex);
        }

        return {
          stream: createScriptedStream({
            abortSignal,
            prompt,
            behavior,
            delayMs,
            scriptedStep,
            usage:
              behavior.kind === 'step-script'
                ? behavior.requestUsages?.[stepIndex]
                : undefined,
          }),
        };
      },
    });

    const streamOptions: Parameters<typeof sdkStreamText>[0] & {
      model: LanguageModelV3;
    } = {
      model,
      messages: input.messages,
      system: input.system,
      abortSignal: input.abortSignal,
      ...(input.tools !== undefined &&
        !wholeStep && {
          tools: input.tools,
          ...(input.toolChoice !== undefined && {
            toolChoice: input.toolChoice,
          }),
          ...((behavior.kind === 'conversation-recall' ||
            behavior.kind === 'tool-script') && {
            stopWhen: toolLoopStopWhen(input),
          }),
        }),
      ...scriptedStreamHandlers(input, settlement),
      ...(wholeStep && { onChunk: undefined }),
    };

    applyRequestUsageCallback(streamOptions, input);

    // The exact record the request streams with is the one the executor's
    // additions mutate in place (`AttemptToolAdditions.bindToolRecord`), which
    // is what every production client binds through
    // `applyToolCallingOptions`: without it, a tool a Workspace MCP server
    // adopts after the entry step is never declared on the next step.
    if (!wholeStep && input.tools !== undefined) {
      input.onToolSet?.(input.tools);
    }

    const gate = createToolCallGate();

    if (wholeStep) {
      // The production tool loop for a whole-step script: execution and
      // refusal report behind the reasoning consumer, schema validation, and
      // the SDK's own error object stored per refused call (design D3/A8).
      applyToolCallingOptions(streamOptions, input, gate);
    }

    // The same step preparation every production client installs: the
    // composer on every step, `onStepStart` and the cap only with tools.
    installStepPreparation(streamOptions, input, this);

    if (!wholeStep) {
      return awaitSettlementAfter(sdkStreamText(streamOptions), settlement);
    }

    return runStreamChannel({
      streamOptions,
      input,
      gate,
      runStreamText: sdkStreamText,
    });
  }
}

/**
 * The system-prompt template a scripted catalog entry carries: the harness
 * identity, and — for a behavior that declares `referencesSkills` — the
 * skill-catalog section a skill-referencing template has, so the model is
 * provably offered the catalog `resolveTurnSkillState` froze for it (a Machine
 * Workspace's skill among them). A production entry derives the flag FROM its
 * template; here the declared behavior is the source of both.
 */
function harnessSystemPromptTemplate(
  modelId: string,
  referencesSkills: boolean,
): string {
  const identity = `Harness prompt for ${modelId}`;

  return referencesSkills
    ? `${identity}\n{{#if skills}}{{#each skills.entries}}<skill name="{{name}}">{{description}}</skill>{{/each}}{{/if}}`
    : identity;
}

/**
 * ModelsService double whose behavior is scripted PER RUN via its modelId —
 * seed a run with a unique modelId, `register()` its behavior before
 * dispatching, and RunsWorkerService.executeJob's `createClient(modelId)`
 * call resolves to it deterministically regardless of which order
 * concurrent jobs actually get claimed in.
 *
 * `implements ModelSelectionValidator` is load-bearing: the harness injects
 * this by Nest override, which is not structurally typechecked, so a method
 * added to the narrow contract would otherwise fail at run time rather than at
 * compile time.
 */
export class ScriptedModelsService implements ModelSelectionValidator {
  private readonly behaviors = new Map<string, ScriptedBehavior>();
  readonly createClientCalls: Array<{ modelId: string }> = [];
  /** Every streamText the executor issued, with the effort and Chat identity it carried. */
  readonly streamCalls: Array<StreamCallRecord> = [];

  register(modelId: string, behavior: ScriptedBehavior): void {
    this.behaviors.set(modelId, behavior);
  }

  /** Per-model reasoning vocabulary a test declares before sending. */
  private readonly reasoning = new Map<string, ModelReasoning>();

  registerReasoning(modelId: string, reasoning: ModelReasoning): void {
    this.reasoning.set(modelId, reasoning);
  }

  /** Per-model declared input a test sets before sending; default `['text']`. */
  private readonly inputs = new Map<string, ReadonlyArray<ModelInput>>();

  registerInput(modelId: string, input: ReadonlyArray<ModelInput>): void {
    this.inputs.set(modelId, input);
  }

  /** Every provider prompt the scripted clients sent, in order. */
  readonly prompts: Array<LanguageModelV3CallOptions['prompt']> = [];

  /**
   * Every declaration set a request carried, in order. Declarations travel
   * beside the prompt, so a test that must see what one Run was offered (a
   * Workspace MCP server's tools, for instance) reads them here.
   */
  readonly declarations: Array<ToolDeclarationRecord> = [];

  validateModelSelection(modelId: string) {
    const reasoning = this.reasoning.get(modelId);

    const referencesSkills =
      this.behaviors.get(modelId)?.referencesSkills === true;

    return {
      id: modelId,
      source: 'system' as const,
      contextWindowTokens: 128_000,
      input: this.inputs.get(modelId) ?? (['text'] as const),
      provider: 'openai',
      providerModelId: modelId,
      systemPromptTemplate: harnessSystemPromptTemplate(
        modelId,
        referencesSkills,
      ),
      systemPromptSource: 'project_default' as const,
      referencesSkills,
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

    return new HarnessModelClient(
      modelId,
      behavior,
      {
        streamCalls: this.streamCalls,
        prompts: this.prompts,
        declarations: this.declarations,
      },
      this.inputs.get(modelId) ?? ['text'],
    );
  }
}
