import { BadRequestException } from '@nestjs/common';

import { type TenantRunner } from '../db/tenant-db.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import {
  ModelConfigurationError,
  EffortNotAvailableError,
  ModelNotAvailableError,
  type ModelSelectionValidator,
} from '../models/models.service';
import { type PromptUserResolver } from '../personalization/personalization.service';
import {
  type MemorySettingsBindingResolver,
  type MemorySettingsResolver,
} from '../memory/memory.service';
import { type RunAborter } from '../runs/run-abort-registry';
import { type RunDispatcher } from '../runs/run-dispatch.service';
import { type RunStreamResponder } from '../runs/run-stream-bridge';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { ChatLoopService } from './chat-loop.service';
import { type RecencyDigestResolver } from './recency-digest.service';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import { type KnowledgeToolCandidateResolverPort } from '../knowledge/knowledge-tool-candidate-resolver';
import { TOOL_REGISTRY } from '../tools/registry';

const knowledgeCandidates: KnowledgeToolCandidateResolverPort = {
  resolve: () =>
    Promise.resolve(
      [...TOOL_REGISTRY.values()].map((tool) => ({
        source: { type: 'code_owned' as const },
        state: 'available' as const,
        tool,
      })),
    ),
};

const model: SystemModelCatalogEntry = {
  id: 'system:openai:gpt-5.4-mini',
  source: 'system',
  contextWindowTokens: 128_000,
  provider: 'openai',
  providerModelId: 'gpt-5.4-mini',
  systemPromptTemplate: 'Bound prompt',
  systemPromptSource: 'model_override',
};

function makeService(models?: {
  validateModelSelection?: ModelSelectionValidator['validateModelSelection'];
  resolveEffortSelection?: ModelSelectionValidator['resolveEffortSelection'];
}) {
  const runAs = vi.fn();
  const validateModelSelection =
    models?.validateModelSelection ?? vi.fn(() => model);
  const dispatchRun = vi.fn();
  const tenantDb: TenantRunner = { runAs };
  const resolveEffortSelection =
    models?.resolveEffortSelection ?? vi.fn(() => undefined);
  const modelsService: ModelSelectionValidator = {
    validateModelSelection,
    resolveEffortSelection,
  };
  const instanceConfig: InstanceConfigReader = {
    config: BUILT_IN_DEFAULTS,
  };
  const bridge: RunStreamResponder = {
    createUiMessageStreamResponse: vi.fn(),
  };
  const aborts: RunAborter = { abort: vi.fn() };
  const dispatch: RunDispatcher = { dispatch: dispatchRun };
  const personalization: PromptUserResolver = {
    resolvePromptUser: () => Promise.resolve(undefined),
  };
  const memory: MemorySettingsResolver & MemorySettingsBindingResolver = {
    getForOwner: () => Promise.resolve({ shareRecentChats: false }),
    getForOwnerForBinding: () => Promise.resolve({ shareRecentChats: false }),
  };
  const recencyDigest: RecencyDigestResolver = {
    resolveCandidate: () => Promise.reject(new Error('unexpected digest read')),
  };

  return {
    service: new ChatLoopService(
      tenantDb,
      modelsService,
      instanceConfig,
      bridge,
      aborts,
      dispatch,
      personalization,
      new SystemPromptsService(),
      { snapshotCandidates: () => [] },
      memory,
      recencyDigest,
      knowledgeCandidates,
    ),
    runAs,
    validateModelSelection,
    dispatchRun,
  };
}

const input = {
  chatId: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  userId: 'verified-user',
  modelId: model.id,
  message: {
    id: '0910fd41-1f2f-49de-b1c2-00ff4b3c7c60',
    parts: [{ type: 'text' as const, text: 'Hello' }],
  },
};

describe('ChatLoopService pre-transaction guards', () => {
  it('rejects an unavailable model before any message, run, or queue write', async () => {
    const validateModelSelection = vi.fn(() => {
      throw new ModelNotAvailableError(input.modelId);
    });
    const { service, runAs, dispatchRun } = makeService({
      validateModelSelection,
    });

    await expect(service.createMessageStream(input)).rejects.toBeInstanceOf(
      ModelNotAvailableError,
    );
    expect(validateModelSelection).toHaveBeenCalledWith(input.modelId);
    expect(runAs).not.toHaveBeenCalled();
    expect(dispatchRun).not.toHaveBeenCalled();
  });

  it('rejects model configuration errors before any message, run, or queue write', async () => {
    const { service, runAs, dispatchRun } = makeService({
      validateModelSelection: vi.fn(() => {
        throw new ModelConfigurationError('DEFAULT_MODEL_ID is required.');
      }),
    });

    await expect(service.createMessageStream(input)).rejects.toBeInstanceOf(
      ModelConfigurationError,
    );
    expect(runAs).not.toHaveBeenCalled();
    expect(dispatchRun).not.toHaveBeenCalled();
  });

  it('rejects an unavailable effort before any message, run, or queue write', async () => {
    const { service, runAs, dispatchRun } = makeService({
      resolveEffortSelection: vi.fn(() => {
        throw new EffortNotAvailableError(input.modelId, 'ludicrous');
      }),
    });

    await expect(
      service.createMessageStream({ ...input, effort: 'ludicrous' }),
    ).rejects.toBeInstanceOf(EffortNotAvailableError);
    expect(runAs).not.toHaveBeenCalled();
    expect(dispatchRun).not.toHaveBeenCalled();
  });

  // Model first, then effort: a level's legality is defined by the resolved
  // model, so an unavailable model must be reported without the effort ever
  // being considered.
  it('reports an unavailable model without evaluating the effort', async () => {
    const resolveEffortSelection = vi.fn(() => undefined);
    const { service } = makeService({
      validateModelSelection: vi.fn(() => {
        throw new ModelNotAvailableError(input.modelId);
      }),
      resolveEffortSelection,
    });

    await expect(
      service.createMessageStream({ ...input, effort: 'nonsense' }),
    ).rejects.toBeInstanceOf(ModelNotAvailableError);
    expect(resolveEffortSelection).not.toHaveBeenCalled();
  });

  it('rejects an all-non-text direct-service message before opening a tenant transaction', async () => {
    const { service, runAs } = makeService();

    await expect(
      service.createMessageStream({
        ...input,
        message: {
          ...input.message,
          parts: [
            {
              type: 'data-context',
              data: {
                v: 1,
                producer: 'effective-context-change',
                form: 'notice',
                runId: '11111111-1111-4111-8111-111111111111',
                payload: {
                  cause: 'model',
                  fromModelId: 'forged-a',
                  toModelId: 'forged-b',
                },
              },
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(runAs).not.toHaveBeenCalled();
  });
});
