import { type UnknownRecord } from '@workspace/runtime-safety';

/**
 * The scripted model client backing `worker-harness.ts`: a `ModelClient`
 * double whose behavior is chosen per run (immediate completion, a delay, a
 * provider error, an infra throw, an indefinite hang that only reacts to
 * abort, a conversation-recall tool-call script, or a whole provider step with
 * reasoning, text, parallel calls, metadata, refusals, and a stream error),
 * plus the `ModelSelectionValidator` double (`ScriptedModelsService`) that
 * resolves it by modelId. Split out of `worker-harness.ts` (which imports these
 * names) so each file stays under the size trip-wire on its own; the stream it
 * serves a turn from lives in `scripted-model-stream.ts`.
 */

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
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
  type ChatModelSelection,
  type SelectionCatalog,
  type SelectionRequest,
  type SelectionWriter,
} from '../models/model-selection';
import {
  resolveEffortSelection,
  resolveSelectionFromCatalog,
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
import {
  createScriptedStream,
  type HarnessBehavior,
} from './scripted-model-stream';
import { PROVIDER_ZERO_USAGE, type ScriptedStep } from './scripted-model-step';
import {
  providerDeclarations,
  type ScriptedModelRecords,
  type StreamCallRecord,
  type ToolDeclarationRecord,
} from './scripted-model-records';

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
  | { kind: 'sync-throw'; error: Error }
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
      /**
       * Usage reported by each provider request, indexed by scripted step.
       * `null` reports usage without an input-token count.
       */
      requestUsages?: ReadonlyArray<LanguageModelV3Usage | null>;
      /**
       * Runs while the model responds to step `stepIndex` (counted across the
       * Run's segments), before that step's stream opens: a test stores a
       * pending steer or records a cancellation at a deterministic moment.
       */
      beforeStep?: (stepIndex: number) => Promise<void> | void;
    }
);

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

    if (this.behavior.kind === 'sync-throw') {
      throw this.behavior.error;
    }

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

        const requestUsage =
          behavior.kind === 'step-script'
            ? behavior.requestUsages?.[stepIndex]
            : undefined;

        return {
          stream: createScriptedStream({
            abortSignal,
            prompt,
            behavior,
            delayMs,
            scriptedStep,
            usage:
              requestUsage === null
                ? {
                    ...PROVIDER_ZERO_USAGE,
                    inputTokens: {
                      total: undefined,
                      noCache: undefined,
                      cacheRead: undefined,
                      cacheWrite: undefined,
                    },
                  }
                : requestUsage,
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

  /**
   * The catalogue the production resolver reads: the harness declares no
   * roles and no default selector, so every id the scripted validator can
   * synthesize is an exact selector.
   */
  private readonly selectionCatalog: SelectionCatalog = {
    defaultSelector: undefined,
    roleCandidates: () => undefined,
    model: (modelId) => this.validateModelSelection(modelId),
  };

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

  /**
   * Delegates to the production resolver rather than restating its rules: a
   * change to selector or effort semantics cannot pass the integration tests
   * while the API behaves differently. The harness declares no roles and no
   * default selector, so every registered model id is an exact selector and an
   * unset default has no fallback.
   */
  resolveSelection(
    stored: ChatModelSelection | null,
    request: SelectionRequest,
    writer: SelectionWriter,
    now: Date,
  ) {
    return resolveSelectionFromCatalog(this.selectionCatalog, {
      stored,
      request,
      writer,
      now,
    });
  }

  resolveTitleModelConfig() {
    return {
      id: 'system:openai:gpt-5.4-nano',
      source: 'system' as const,
      provider: 'openai',
      providerModelId: 'gpt-5.4-nano',
    };
  }

  resolveTitleModelCandidates() {
    return {
      models: [
        {
          ...this.resolveTitleModelConfig(),
          billing: 'subscription' as const,
        },
      ],
      allowPaidFallback: false,
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
