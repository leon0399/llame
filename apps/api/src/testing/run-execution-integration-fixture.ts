/**
 * The harness the follow-up Run integration suites share: a scripted model
 * client over the AI SDK's test adapter, and the `RunExecutionService` those
 * suites drive against a real Postgres. Continue and Regenerate differ in what
 * they seed and assert, never in how the service is wired, so the wiring lives
 * here once.
 */

import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { streamText } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';

import { TenantDbService } from '../db/tenant-db.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { type CompactionCapability } from '../compaction/compaction.service';
import { RecencyDigestService } from '../chats/recency-digest.service';
import { MemoryService } from '../memory/memory.service';
import { type ModelClient } from '../models/model-client';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { type ModelSelectionValidator } from '../models/models.service';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { noopSkillCatalog } from '../skills/skill-catalog.stub';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import { compileTestPermissionPolicy } from './tool-permission-policy';
import { getRegisteredToolIds } from '../tools/registry';
import { type KnowledgeToolResolver } from '../tools/types';
import { RunExecutionService } from '../runs/run-execution.service';

/** A text-only catalog entry for one mock model. */
export function catalogEntry(id: string): SystemModelCatalogEntry {
  return {
    id,
    source: 'system',
    contextWindowTokens: 128_000,
    provider: 'mock',
    providerModelId: id,
    billing: 'subscription',
    systemPromptTemplate: 'Test prompt',
    systemPromptSource: 'model_override',
    referencesSkills: false,
    input: ['text'],
  };
}

/** A validator over the entries a suite declares, by id. */
export function catalogValidator(
  entries: ReadonlyArray<SystemModelCatalogEntry>,
): ModelSelectionValidator {
  return {
    validateModelSelection: (modelId) => {
      const entry = entries.find(({ id }) => id === modelId);
      if (entry === undefined) throw new Error(`Unknown model ${modelId}`);
      return entry;
    },
    resolveEffortSelection: () => undefined,
  };
}

export const knowledgeResolver: KnowledgeToolResolver = {
  listForOwnerPage: () => Promise.resolve({ spaces: [] }),
  resolveBindingForOwnerById: () => Promise.resolve(undefined),
  createAdapter: () => ({
    search: () => Promise.resolve([]),
    resolveHostPath: () =>
      Promise.reject(new Error('Knowledge adapter is not exercised')),
    isInsideSpace: () => Promise.resolve(true),
  }),
};

export function answerChunks(text: string): Array<LanguageModelV3StreamPart> {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: text },
    { type: 'text-end', id: 'text' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ];
}

export function scriptedModel(
  chunks: Array<LanguageModelV3StreamPart>,
): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: () =>
      Promise.resolve({ stream: simulateReadableStream({ chunks }) }),
  });
}

/** A client over a scripted model, recording every request the Run sends. */
export function scriptedClient(
  model: MockLanguageModelV3,
  modelId: string,
  options: {
    requests?: Array<Parameters<ModelClient['streamText']>[0]>;
    contextWindowTokens?: number;
  } = {},
): ModelClient {
  return {
    model: modelId,
    provider: 'mock',
    contextWindowTokens: options.contextWindowTokens ?? 128_000,
    streamText(input) {
      options.requests?.push(input);
      return streamText({
        model,
        system: input.system,
        messages: input.messages,
        abortSignal: input.abortSignal,
        onChunk: ({ chunk }) => {
          if (chunk.type === 'text-delta') input.onTextDelta?.(chunk.text);
        },
        onError: input.onError,
        onFinish: (event) =>
          input.onFinish?.({
            text: event.text,
            usage: event.usage,
            finishReason: event.finishReason,
            stepCount: event.steps.length,
          }),
      });
    },
  };
}

/**
 * The service a follow-up suite drives. Every seeded turn fits the model's
 * window unless a case narrows it, so a window summary request would be a
 * scenario these suites do not exercise.
 */
export function makeRunExecutionService(input: {
  tenantDb: TenantDbService;
  instanceConfig: InstanceConfigReader;
  models: ModelSelectionValidator;
}): RunExecutionService {
  const noopCompaction: CompactionCapability = {
    summarizeCheckpoint: (request) =>
      request.variant === 'window'
        ? Promise.reject(new Error('window summarization is not exercised'))
        : Promise.resolve(null),
  };
  return new RunExecutionService(
    input.tenantDb,
    noopCompaction,
    { maybeGenerateTitle: async () => {} },
    input.instanceConfig,
    { reindexChat: () => Promise.resolve() },
    noopReindexDispatch(),
    knowledgeResolver,
    noopSkillCatalog(),
    noopEmbedDispatch(),
    noopQueryEmbedder(),
    compileTestPermissionPolicy(getRegisteredToolIds()),
    input.models,
    new SystemPromptsService(),
    { resolvePromptUser: () => Promise.resolve(undefined) },
    { resolve: () => Promise.resolve([]) },
    { snapshotCandidates: () => [] },
    new MemoryService(input.tenantDb),
    new RecencyDigestService(input.tenantDb),
  );
}
