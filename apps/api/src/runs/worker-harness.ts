/**
 * Composite worker harness (durable-run-workers, task 7.0) — the prerequisite
 * for tasks 7.1-7.3/7.6/7.7: wires a REAL pg-boss `runs` queue + a live
 * `RunsWorkerService` (+ its `runs.dead` consumer) + `RunExecutionService` +
 * `TenantDbService` in ONE Nest DI graph, with a scripted fake model client
 * the test controls per-run (immediate completion, a delay, an infra throw,
 * or an indefinite hang that only reacts to abort).
 *
 * Reuses rather than reinvents:
 * - `WorkerModule` (apps/api/src/worker.module.ts) IS the composed graph —
 *   `QueueModule` + `RunWorkerModule` (RunsWorkerService, RunExecutionService,
 *   RunDispatchService) + `SearchModule` (inline reindex, 7.6) + `AuthModule`
 *   + the `DB_DEV` Drizzle connection — exactly what 7.0 asks for, so this
 *   harness boots WorkerModule itself rather than hand-composing a parallel
 *   module graph (worker.module.integration.test.ts already proves this composition boots
 *   headless and drains on shutdown; this harness reuses that proof).
 * - `waitFor`/`describeIfDb` conventions from `queue.integration.test.ts` /
 *   `src/testing/support.ts` (callers import waitFor themselves).
 * - The direct-instantiation-of-repos pattern from
 *   `active-runs.integration.test.ts` for seeding chat/message/run rows.
 *
 * TEST_DATABASE_URL/POSTGRES_URL-gated by the CALLER (this module has no
 * `describe` of its own — it is imported by the actual spec files).
 */

import { Test, type TestingModule } from '@nestjs/testing';
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultOutput,
} from '@ai-sdk/provider';
import { sql } from 'drizzle-orm';
import { stepCountIs, streamText as sdkStreamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { type Sql } from 'postgres';
import { z } from 'zod';

import { WorkerModule } from '../worker.module';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import type { ModelReasoning } from '../models/model-catalog';
import {
  ModelsService,
  resolveEffortSelection,
  type ModelSelectionValidator,
} from '../models/models.service';
import { wrapStreamTextResult } from '../models/stream-text-result-proxy';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { type EnqueueOptions, QUEUE, type Queue } from '../queue/queue';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { type TextPart } from '../chats/context-builder';
import { RunDispatchService } from './run-dispatch.service';
import { type RunUserMessage } from './run-execution.service';
import { RUNS_QUEUE, type RunJob } from './run-queues';
import { RunsRepository } from './runs-repository';
import { seedModelContextSnapshot } from './model-context-snapshot.test-fixture';

// ---- Scripted model client ------------------------------------------------

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
      limit: z.number().int().positive().max(2_000),
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
  const outputs: z.output<typeof conversationSearchOutputSchema>[] = [];
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
  const outputs: z.output<typeof conversationReadOutputSchema>[] = [];
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

function conversationRecallParts(
  prompt: LanguageModelV3CallOptions['prompt'],
  behavior: ConversationRecallBehavior,
): LanguageModelV3StreamPart[] {
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

  return [
    {
      type: 'text-start',
      id: 'answer',
    },
    {
      type: 'text-delta',
      id: 'answer',
      delta: behavior.finalText ?? 'The source was read.',
    },
    {
      type: 'text-end',
      id: 'answer',
    },
  ];
}

class HarnessModelClient implements ModelClient {
  readonly provider = 'fake';
  readonly contextWindowTokens = 128_000;

  constructor(
    readonly model: string,
    private readonly behavior: Extract<
      ScriptedBehavior,
      | { kind: 'complete' }
      | { kind: 'provider-error' }
      | { kind: 'hang' }
      | { kind: 'conversation-recall' }
    >,
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
    let abortSettlement = Promise.resolve();
    let abortSettlementError: { error: unknown } | undefined;
    const waitForAbortSettlement = async () => {
      await abortSettlement;
      if (abortSettlementError) {
        throw abortSettlementError.error;
      }
    };
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
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            async start(controller) {
              let delayTimer: ReturnType<typeof setTimeout> | undefined;
              let unblock: () => void = noop;
              const onAbort = () => {
                if (delayTimer) {
                  clearTimeout(delayTimer);
                }
                controller.error(new DOMException('Aborted', 'AbortError'));
                unblock();
              };
              if (abortSignal?.aborted) {
                onAbort();
                return;
              }
              abortSignal?.addEventListener('abort', onAbort, { once: true });

              try {
                if (behavior.kind === 'hang') {
                  await new Promise<void>((resolve) => {
                    unblock = resolve;
                  });
                  return;
                }
                if (delayMs) {
                  await new Promise<void>((resolve) => {
                    unblock = resolve;
                    delayTimer = setTimeout(resolve, delayMs);
                  });
                }
                if (abortSignal?.aborted) {
                  return;
                }
                controller.enqueue({ type: 'stream-start', warnings: [] });
                if (behavior.kind === 'conversation-recall') {
                  const parts = conversationRecallParts(
                    // The V3 provider prompt is the only place where prior
                    // tool results are available to this scripted model.
                    // `prompt` is passed through by MockLanguageModelV3.
                    prompt,
                    behavior,
                  );
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
                  controller.close();
                  return;
                }
                controller.enqueue({ type: 'text-start', id: 'answer' });
                if (text.length > 0) {
                  controller.enqueue({
                    type: 'text-delta',
                    id: 'answer',
                    delta: text,
                  });
                }
                controller.enqueue({ type: 'text-end', id: 'answer' });
                controller.enqueue({
                  type: 'finish',
                  finishReason: { unified: 'stop', raw: undefined },
                  usage: PROVIDER_ZERO_USAGE,
                });
                controller.close();
              } catch (error) {
                controller.error(error);
              } finally {
                abortSignal?.removeEventListener('abort', onAbort);
              }
            },
          }),
        });
      },
    });

    const result = sdkStreamText({
      model,
      messages: input.messages,
      system: input.system,
      abortSignal: input.abortSignal,
      ...(input.tools && {
        tools: input.tools,
        ...(input.toolChoice !== undefined && {
          toolChoice: input.toolChoice,
        }),
        ...(behavior.kind === 'conversation-recall' && {
          stopWhen: stepCountIs((input.maxSteps ?? 8) + 1),
        }),
      }),
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          input.onTextDelta?.(chunk.text);
        } else if (chunk.type === 'reasoning-delta') {
          input.onReasoningDelta?.(chunk.text);
        }
      },
      onError: input.onError,
      onAbort: () => {
        abortSettlement = Promise.resolve(
          input.onError?.({
            error: input.abortSignal?.reason ?? new Error('aborted'),
          }),
        ).catch((error: unknown) => {
          abortSettlementError = { error };
        });
      },
      onFinish: ({ text: response, usage, finishReason }) =>
        input.onFinish?.({ text: response, usage, finishReason }),
    });

    return wrapStreamTextResult(result, {
      consumeStream: (target) => ({
        value: async (...args: Parameters<typeof target.consumeStream>) => {
          await target.consumeStream(...args);
          await waitForAbortSettlement();
        },
      }),
      text: (target) => ({
        value: (async () => {
          try {
            return await target.text;
          } finally {
            await waitForAbortSettlement();
          }
        })(),
      }),
    });
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

// ---- Harness boot ----------------------------------------------------------

export type WorkerHarness = {
  moduleRef: TestingModule;
  tenantDb: TenantDbService;
  db: Db;
  models: ScriptedModelsService;
  queue: Queue;
  dispatch: RunDispatchService;
  close(): Promise<void>;
};

type DrizzleWithClient = Db & { $client: Sql };

/**
 * Boots WorkerModule as a headless Nest graph (moduleRef.init(), no HTTP —
 * same shape as `worker.module.integration.test.ts`) against a REAL Postgres, with:
 * - ModelsService replaced by a ScriptedModelsService the test scripts per run
 * - InstanceConfigService replaced by a plain config object so the test can
 *   set `runs.timeoutSeconds`/`heartbeatSeconds` and the `all` profile's
 *   `runs` concurrency without an on-disk llame.config.json
 *
 * A unique PGBOSS_SCHEMA per boot avoids cross-suite job-stealing on a shared
 * Postgres (same rationale as worker.module.integration.test.ts / queue.module.ts).
 */
export async function bootWorkerHarness(overrides?: {
  runsConcurrency?: number;
  timeoutSeconds?: number;
  heartbeatSeconds?: number;
  /** Explicit code-owned tool rules for snapshots seeded by this harness. */
  allowedTools?: readonly string[];
}): Promise<WorkerHarness> {
  // WorkerModule's DrizzlePostgresModule/PgBossModule read POSTGRES_URL
  // directly (getOrThrow), not TEST_DATABASE_URL — mirror worker.module.integration.test.ts's
  // own setup rather than relying on POSTGRES_URL being ambient in the
  // caller's shell (it must not be a hard requirement for callers gated only
  // on TEST_DATABASE_URL, e.g. a bare test:integration run).
  //
  // UNCONDITIONAL, like worker.module.integration.test.ts: ConfigModule.forRoot has
  // already leaked a developer's .env.local POSTGRES_URL (the DEV database)
  // into process.env by the time this runs, so a `!process.env.POSTGRES_URL`
  // guard would silently point the whole harness at the dev database instead
  // of the provisioned test one.
  if (process.env.TEST_DATABASE_URL) {
    process.env.POSTGRES_URL = process.env.TEST_DATABASE_URL;
  }
  process.env.PGBOSS_SCHEMA = `${process.env.LLAME_TEST_SCHEMA_PREFIX ?? 'llame_t'}_wh_${Math.random().toString(36).slice(2, 8)}`;

  const models = new ScriptedModelsService();
  const config: LlameConfig = {
    ...BUILT_IN_DEFAULTS,
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      allowed: [...(overrides?.allowedTools ?? [])],
    },
    runs: {
      ...BUILT_IN_DEFAULTS.runs,
      timeoutSeconds:
        overrides?.timeoutSeconds ?? BUILT_IN_DEFAULTS.runs.timeoutSeconds,
      heartbeatSeconds:
        overrides?.heartbeatSeconds ?? BUILT_IN_DEFAULTS.runs.heartbeatSeconds,
    },
    workers: {
      ...BUILT_IN_DEFAULTS.workers,
      all: {
        ...BUILT_IN_DEFAULTS.workers.all,
        runs: overrides?.runsConcurrency ?? BUILT_IN_DEFAULTS.workers.all.runs,
      },
    },
  };

  const builder = Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(ModelsService)
    .useValue(models)
    .overrideProvider(InstanceConfigService)
    .useValue({ config })
    // Execution harnesses isolate the worker loop, not fleet-wide projection
    // admission; dedicated boot tests exercise the real coverage gate.
    .overrideProvider(CanonicalSearchCoverageService)
    .useValue({ assertReady: () => Promise.resolve() });
  const moduleRef = await builder.compile();

  await moduleRef.init();

  const tenantDb = moduleRef.get(TenantDbService, { strict: false });
  const db = moduleRef.get<DrizzleWithClient>('DB_DEV', { strict: false });
  const queue = moduleRef.get<Queue>(QUEUE, { strict: false });
  const dispatch = moduleRef.get(RunDispatchService, { strict: false });

  return {
    moduleRef,
    tenantDb,
    db,
    models,
    queue,
    dispatch,
    async close() {
      // Graceful drain (design D5): close() runs onModuleDestroy, which triggers
      // nestjs-pgboss's boss.stop({ graceful }) — stops fetching and awaits
      // in-flight handlers.
      await moduleRef.close();
      await db.$client.end();
    },
  };
}

// ---- Fixtures --------------------------------------------------------------

/** Insert a bare `users` row (FK target for chats/messages/runs), like active-runs.integration.test.ts. */
export async function createUser(db: Db, tag: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute(
    sql`INSERT INTO users (id, name, email) VALUES (${id}, ${'Harness User'}, ${`harness-${tag}-${id}@test.com`})`,
  );
  return id;
}

/**
 * Seed a chat + user message + run row in one transaction (mirrors
 * ChatLoopService.persistUserMessageAndRun's shape, minus the queue
 * dispatch/single-flight retry — callers that need to exercise the
 * unique-violation path do so explicitly). Pass `chatId` to add a second
 * message+run to an EXISTING chat (e.g. to attempt violating single-flight).
 */
export async function seedRun(input: {
  tenantDb: TenantDbService;
  userId: string;
  modelId: string;
  text?: string;
  chatId?: string;
  /** Persisted on the run exactly as the accepting API would have stored it. */
  effort?: string;
  /** Exact code-owned tool rules captured by the run's immutable snapshot. */
  allowedTools?: readonly string[];
}): Promise<{
  chatId: string;
  runId: string;
  modelContextSnapshotId: string;
  userMessage: RunUserMessage;
}> {
  const chatId = input.chatId ?? crypto.randomUUID();
  return input.tenantDb.runAs(input.userId, async (tx) => {
    if (!input.chatId) {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: input.userId,
        // Non-null title: sidesteps the post-completion title-generation
        // model call (untitled-gate in RunExecutionService.onFinish) so the
        // scripted model doesn't need a behavior registered for it.
        title: 'Harness chat',
      });
    }
    const parts: TextPart[] = [{ type: 'text', text: input.text ?? 'hello' }];
    const message = await new MessagesRepository(tx).create({
      chatId,
      role: 'user',
      senderUserId: input.userId,
      parts,
    });
    const snapshot = await seedModelContextSnapshot(
      tx,
      input.userId,
      input.modelId,
      input.allowedTools ?? [],
    );
    const run = await new RunsRepository(tx).create({
      chatId,
      messageId: message.id,
      userId: input.userId,
      modelId: input.modelId,
      ...(input.effort !== undefined && { effort: input.effort }),
      modelContextSnapshotId: snapshot.id,
    });
    return {
      chatId,
      runId: run.id,
      modelContextSnapshotId: snapshot.id,
      userMessage: {
        id: message.id,
        seq: message.seq,
        parts,
      },
    };
  });
}

/** Enqueue a seeded run onto the real `runs` queue, with optional per-job EnqueueOptions overrides (e.g. a fast retryLimit for the retry-exhaustion test). */
export async function dispatchRun(input: {
  queue: Queue;
  chatId: string;
  runId: string;
  userId: string;
  modelId: string;
  userMessage: RunUserMessage;
  enqueueOptions?: EnqueueOptions;
}): Promise<string | null> {
  const job: RunJob = {
    runId: input.runId,
    chatId: input.chatId,
    userId: input.userId,
    modelId: input.modelId,
    userMessage: input.userMessage,
  };
  return input.queue.enqueue(RUNS_QUEUE, job, input.enqueueOptions);
}

/**
 * `seedRun` immediately followed by `dispatchRun` for that same run — the
 * pattern most call sites want (seed one run, enqueue it, done). Callers that
 * need to seed several runs before dispatching any of them (e.g. to measure
 * wall-clock time starting only at dispatch) should keep calling `seedRun`/
 * `dispatchRun` directly instead.
 */
export async function seedAndDispatchRun(
  harness: Pick<WorkerHarness, 'tenantDb' | 'queue'>,
  input: {
    userId: string;
    modelId: string;
    text?: string;
    chatId?: string;
    /** Persisted on the run exactly as the accepting API would have stored it. */
    effort?: string;
    /** Exact code-owned tool rules captured by the run's immutable snapshot. */
    allowedTools?: readonly string[];
    enqueueOptions?: EnqueueOptions;
  },
): Promise<{
  chatId: string;
  runId: string;
  modelContextSnapshotId: string;
  userMessage: RunUserMessage;
}> {
  const seed = await seedRun({
    tenantDb: harness.tenantDb,
    userId: input.userId,
    modelId: input.modelId,
    text: input.text,
    chatId: input.chatId,
    ...(input.effort !== undefined && { effort: input.effort }),
    ...(input.allowedTools !== undefined && {
      allowedTools: input.allowedTools,
    }),
  });
  await dispatchRun({
    queue: harness.queue,
    chatId: seed.chatId,
    runId: seed.runId,
    userId: input.userId,
    modelId: input.modelId,
    userMessage: seed.userMessage,
    enqueueOptions: input.enqueueOptions,
  });
  return seed;
}
