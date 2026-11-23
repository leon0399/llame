import path from 'node:path';

import type { InstanceConfigReader } from '../instance-config/instance-config.service';
import type { ProductIdentityReader } from '../instance-config/product-identity';
import { loadInstanceConfig } from '../instance-config/config-loader';
import { type DecisionModelConfig } from '../instance-config/decision-catalog';
import {
  BUILT_IN_DEFAULTS,
  type ProviderConfig,
} from '../instance-config/llame-config';
import type { ModelRoleConfig } from '../instance-config/model-roles-config';
import type { RerankModelConfig } from '../instance-config/rerank-config';
import type { ModelReasoning, SystemModelCatalogEntry } from './model-catalog';
import type { BillingMode } from './model-client';
import { createModelClient } from './model-client-factory';
import type { createOpenAICompletionsModelClient } from './openai-completions-model-client';
import type { createOpenAIModelClient } from './openai-model-client';
import {
  ModelConfigurationError,
  EffortNotAvailableError,
  ModelNotAvailableError,
  PermissionModeNotAvailableError,
  ModelsService,
} from './models.service';

// Test seam (anti-slop/no-module-mocking): overrides the per-wire client
// constructors via ModelsService's own dependency-injection constructor param
// instead of module-mocking ./openai-model-client or
// ./openai-completions-model-client. No provider is registered for that token
// in production, so this override only takes effect when a test constructs
// ModelsService directly, as createService below does.
const createOpenAIModelClientMock = vi.mocked(
  vi.fn<typeof createOpenAIModelClient>(),
  { partial: true },
);

createOpenAIModelClientMock.mockReturnValue({
  model: 'stub',
  provider: 'openai-responses',
  contextWindowTokens: 400_000,
  streamText: vi.fn(),
});

const createOpenAICompletionsModelClientMock = vi.mocked(
  vi.fn<typeof createOpenAICompletionsModelClient>(),
  { partial: true },
);

createOpenAICompletionsModelClientMock.mockReturnValue({
  model: 'stub',
  provider: 'openai-completions',
  contextWindowTokens: 400_000,
  streamText: vi.fn(),
});

const createModelClientOverride: typeof createModelClient = (input) =>
  createModelClient(input, {
    createOpenAIModelClient: createOpenAIModelClientMock,
    createOpenAICompletionsModelClient: createOpenAICompletionsModelClientMock,
  });

const DEFAULT_PROVIDER: ProviderConfig = {
  id: 'openai',
  type: 'openai-responses',
  key: null,
  baseUrl: null,
  headers: {},
};

/** The product token llame's boot-read identity supplies to every client. */
const USER_AGENT = 'llame/0.0.0-test';

// Reproduces the formerly-hardcoded ACTIVE_SYSTEM_MODEL_IDS catalog exactly,
// as config entries — the shipped llame.config.jsonc.example carries the same
// data (providers-and-models-as-code, #167).
const CATALOG: Array<SystemModelCatalogEntry> = [
  {
    id: 'system:openai:gpt-5.5',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-5.5',
    name: 'GPT-5.5',
    contextWindowTokens: 400_000,
    input: ['text', 'image'],
    pricingUsdPer1M: { input: 2.5, cachedInput: 0.25, output: 10 },
    systemPromptTemplate: 'Internal prompt 1',
    systemPromptSource: 'project_default',
    referencesSkills: false,
  },
  {
    id: 'system:openai:gpt-5.4',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-5.4',
    name: 'GPT-5.4',
    contextWindowTokens: 400_000,
    input: ['text', 'image'],
    pricingUsdPer1M: { input: 1.25, cachedInput: 0.125, output: 7.5 },
    systemPromptTemplate: 'Internal prompt 2',
    systemPromptSource: 'project_default',
    referencesSkills: false,
  },
  {
    id: 'system:openai:gpt-5.4-mini',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    contextWindowTokens: 400_000,
    input: ['text', 'image'],
    pricingUsdPer1M: { input: 0.75, cachedInput: 0.075, output: 4.5 },
    systemPromptTemplate: 'Internal prompt 3',
    systemPromptSource: 'model_override',
    referencesSkills: false,
  },
  {
    id: 'system:openai:gpt-5.4-nano',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-5.4-nano',
    name: 'GPT-5.4 Nano',
    contextWindowTokens: 400_000,
    input: ['text'],
    pricingUsdPer1M: { input: 0.1, cachedInput: 0.01, output: 0.4 },
    systemPromptTemplate: 'Internal prompt 4',
    systemPromptSource: 'project_default',
    referencesSkills: false,
  },
  {
    id: 'system:openai:gpt-4o',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-4o',
    name: 'GPT-4o',
    contextWindowTokens: 128_000,
    input: ['text', 'image'],
    pricingUsdPer1M: { input: 2.5, output: 10 },
    systemPromptTemplate: 'Internal prompt 5',
    systemPromptSource: 'project_default',
    referencesSkills: false,
  },
  {
    id: 'system:openai:gpt-4o-mini',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-4o-mini',
    contextWindowTokens: 128_000,
    input: ['text'],
    pricingUsdPer1M: { input: 0.15, cachedInput: 0.075, output: 0.6 },
    systemPromptTemplate: 'Internal prompt 6',
    systemPromptSource: 'project_default',
    referencesSkills: false,
  },
];

/** A one-model catalog entry carrying an explicit resolved billing mode. */
function withBilling(
  id: string,
  billing: BillingMode,
): SystemModelCatalogEntry {
  return {
    id,
    source: 'system',
    provider: 'openai',
    providerModelId: id,
    contextWindowTokens: 128_000,
    input: ['text'],
    systemPromptTemplate: `Internal prompt for ${id}`,
    systemPromptSource: 'project_default',
    referencesSkills: false,
    billing,
  };
}

function createService(overrides: {
  defaultSelector?: string | null;
  titleGenerationSelector?: string | null;
  models?: Array<SystemModelCatalogEntry>;
  providers?: Array<ProviderConfig>;
  modelRoles?: ReadonlyArray<ModelRoleConfig>;
  decisionModels?: Array<DecisionModelConfig>;
  rerankModels?: Array<RerankModelConfig>;
}): ModelsService {
  const instanceConfig: InstanceConfigReader & ProductIdentityReader = {
    productUserAgent: USER_AGENT,
    config: {
      ...BUILT_IN_DEFAULTS,
      defaults: {
        selector: overrides.defaultSelector ?? null,
        titleGenerationSelector: overrides.titleGenerationSelector ?? null,
      },
      providers: overrides.providers ?? [DEFAULT_PROVIDER],
      models: overrides.models ?? CATALOG,
      ...(overrides.modelRoles !== undefined && {
        modelRoles: overrides.modelRoles,
      }),
      ...(overrides.decisionModels !== undefined && {
        decisionModels: overrides.decisionModels,
      }),
      ...(overrides.rerankModels !== undefined && {
        rerankModels: overrides.rerankModels,
      }),
    },
  };

  return new ModelsService(instanceConfig, createModelClientOverride);
}

describe('ModelsService', () => {
  it('exposes the exact unavailable permission mode error contract', () => {
    const error = new PermissionModeNotAvailableError('bypass');

    expect(error.message).toBe("Permission mode 'bypass' is not available.");
    expect(error.code).toBe('permission_mode_not_available');
    expect(error.statusCode).toBe(422);
  });
  beforeEach(() => {
    createOpenAIModelClientMock.mockClear();
    createOpenAICompletionsModelClientMock.mockClear();
  });

  it('returns the configured default and all configured models in catalog order', () => {
    const service = createService({
      defaultSelector: 'system:openai:gpt-5.4-mini',
    });

    const response = service.getAvailableModels();

    expect(response.defaultSelector).toBe('system:openai:gpt-5.4-mini');
    expect(response.roles).toEqual([]);
    expect(response.models.map((model) => model.id)).toEqual(
      CATALOG.map((model) => model.id),
    );
    expect(response.models).toHaveLength(6);
    const [firstModel] = response.models;
    expect(firstModel).toMatchObject({
      id: 'system:openai:gpt-5.5',
      source: 'system',
      name: 'GPT-5.5',
    });
    expect(firstModel.contextWindowTokens).toEqual(expect.any(Number));
    expect(firstModel.pricingUsdPer1M?.input).toEqual(expect.any(Number));
    expect(firstModel.pricingUsdPer1M?.output).toEqual(expect.any(Number));
    expect(firstModel).not.toHaveProperty('providerModelId');
  });

  it('lists no decision model and keeps a chat model that shares a decision id', () => {
    const [chatModel] = CATALOG;

    const service = createService({
      defaultSelector: chatModel.id,
      providers: [
        DEFAULT_PROVIDER,
        {
          id: 'decisions',
          type: 'system-one',
          key: 'decision-key',
          baseUrl: 'https://decisions.example/v1',
          headers: {},
        },
      ],
      decisionModels: [
        {
          id: chatModel.id,
          provider: 'decisions',
          providerModelId: 'jev-1.13',
          limits: {
            perQuestionContextTokens: 8192,
            perRequestContextTokens: 32_768,
            maxQuestionsPerRequest: null,
            maxConcurrentRequests: 32,
          },
        },
        {
          id: 'decision-only',
          provider: 'decisions',
          providerModelId: 'jev-1.14',
          limits: {
            perQuestionContextTokens: 8192,
            perRequestContextTokens: 32_768,
            maxQuestionsPerRequest: null,
            maxConcurrentRequests: 32,
          },
        },
      ],
    });

    const response = service.getAvailableModels();

    expect(response.models.map((model) => model.id)).toEqual(
      CATALOG.map((model) => model.id),
    );
    expect(JSON.stringify(response)).not.toContain('jev-1.1');
    expect(JSON.stringify(response)).not.toContain('decision-key');
  });

  it('lists no rerank model and keeps a chat model that shares a rerank id', () => {
    const [chatModel] = CATALOG;

    const service = createService({
      defaultSelector: chatModel.id,
      providers: [
        DEFAULT_PROVIDER,
        {
          id: 'rerank',
          type: 'cohere-rerank',
          key: 'rerank-key',
          baseUrl: 'https://rerank.example/v2',
          headers: {},
        },
      ],
      rerankModels: [
        {
          id: chatModel.id,
          provider: 'rerank',
          providerModelId: 'rerank-v5.0-fast',
        },
        {
          id: 'rerank-only',
          provider: 'rerank',
          providerModelId: 'rerank-v5.0-pro',
        },
      ],
    });

    const response = service.getAvailableModels();

    expect(response.models.map((model) => model.id)).toEqual(
      CATALOG.map((model) => model.id),
    );
    expect(JSON.stringify(response)).not.toContain('rerank-v5.0');
    expect(JSON.stringify(response)).not.toContain('rerank-key');
  });

  it('publishes a manually declared Codex model without provider credentials or invented pricing', () => {
    const service = createService({
      defaultSelector: 'system:codex:gpt-test',
      providers: [
        {
          id: 'personal-codex',
          type: 'openai-codex',
          key: 'access-token',
          accountId: 'account-id',
          headers: {},
        },
      ],
      models: [
        {
          id: 'system:codex:gpt-test',
          source: 'system',
          provider: 'personal-codex',
          providerModelId: 'gpt-test',
          name: 'Configured Codex model',
          contextWindowTokens: 128_000,
          input: ['text'],
          systemPromptTemplate: 'Internal prompt',
          systemPromptSource: 'project_default',
          referencesSkills: false,
        },
      ],
    });

    const [model] = service.getAvailableModels().models;

    expect(model).toMatchObject({
      id: 'system:codex:gpt-test',
      name: 'Configured Codex model',
      contextWindowTokens: 128_000,
    });
    expect(model).not.toHaveProperty('pricingUsdPer1M');
    expect(JSON.stringify(model)).not.toContain('personal-codex');
    expect(JSON.stringify(model)).not.toContain('access-token');
    expect(JSON.stringify(model)).not.toContain('account-id');
  });

  it('rejects a missing, blank, or unknown default selector as typed server configuration failure', () => {
    for (const defaultSelector of [undefined, null, 'not-configured']) {
      const service = createService({ defaultSelector });

      expect(() => service.getAvailableModels()).toThrow(
        ModelConfigurationError,
      );

      try {
        service.getAvailableModels();
        throw new Error('expected getAvailableModels to throw');
      } catch (error) {
        if (!(error instanceof ModelConfigurationError)) {
          throw new Error('Expected a ModelConfigurationError', {
            cause: error,
          });
        }

        expect(error.code).toBe('model_configuration_invalid');
        expect(error.statusCode).toBe(503);
      }
    }
  });

  it('requires the default selector to reference a configured model or model role', () => {
    const service = createService({
      defaultSelector: 'system:openai:gpt-4.1',
    });

    expect(() => service.getAvailableModels()).toThrow(
      /defaults\.selector must reference a configured model or model role/,
    );

    const missingRole = createService({ defaultSelector: '@missing' });

    expect(() => missingRole.getAvailableModels()).toThrow(
      /defaults\.selector must reference a configured model or model role/,
    );
  });

  it('resolves title generation only when it points to a configured model', () => {
    expect(
      createService({
        titleGenerationSelector: 'system:openai:gpt-5.4-nano',
      }).resolveTitleModelConfig(),
    ).toMatchObject({
      id: 'system:openai:gpt-5.4-nano',
      providerModelId: 'gpt-5.4-nano',
    });

    expect(
      createService({
        titleGenerationSelector: undefined,
      }).resolveTitleModelConfig()?.id,
    ).toBeUndefined();
    expect(
      createService({
        titleGenerationSelector: 'unknown',
      }).resolveTitleModelConfig()?.id,
    ).toBeUndefined();
  });

  describe('model roles', () => {
    it('publishes roles in config order, marking only usage billing as paid', () => {
      const service = createService({
        defaultSelector: '@coding',
        models: [
          withBilling('system:openai:per-token', 'usage'),
          withBilling('system:openai:plan', 'subscription'),
          withBilling('system:openai:free', 'free'),
        ],
        modelRoles: [
          {
            name: 'coding',
            candidates: [
              { modelId: 'system:openai:per-token', effort: 'high' },
              { modelId: 'system:openai:plan' },
            ],
          },
          {
            name: 'titles',
            candidates: [{ modelId: 'system:openai:free' }],
          },
        ],
      });

      const response = service.getAvailableModels();

      expect(response.roles).toEqual([
        {
          selector: '@coding',
          candidates: [
            {
              modelId: 'system:openai:per-token',
              effort: 'high',
              paid: true,
            },
            { modelId: 'system:openai:plan', paid: false },
          ],
        },
        {
          selector: '@titles',
          candidates: [{ modelId: 'system:openai:free', paid: false }],
        },
      ]);
      // An undeclared effort is absent, never `null` and never `undefined`.
      expect(response.roles[0]?.candidates[1]).not.toHaveProperty('effort');
      // `paid` is the only billing datum published.
      expect(JSON.stringify(response.roles)).not.toContain('billing');
    });

    it('publishes a role selector as the default and resolves it to the primary candidate', () => {
      const service = createService({
        defaultSelector: '@coding',
        models: [
          withBilling('system:openai:primary', 'subscription'),
          withBilling('system:openai:secondary', 'usage'),
        ],
        modelRoles: [
          {
            name: 'coding',
            candidates: [
              { modelId: 'system:openai:primary' },
              { modelId: 'system:openai:secondary' },
            ],
          },
        ],
      });

      expect(service.getAvailableModels().defaultSelector).toBe('@coding');
      expect(service.resolveDefaultModelConfig().id).toBe(
        'system:openai:primary',
      );
    });

    it('resolves a title-generation role to its primary candidate', () => {
      const service = createService({
        defaultSelector: '@coding',
        titleGenerationSelector: '@titles',
        models: [
          withBilling('system:openai:primary', 'usage'),
          withBilling('system:openai:secondary', 'usage'),
        ],
        modelRoles: [
          {
            name: 'coding',
            candidates: [{ modelId: 'system:openai:primary' }],
          },
          {
            name: 'titles',
            candidates: [
              { modelId: 'system:openai:secondary', effort: 'low' },
              { modelId: 'system:openai:primary' },
            ],
          },
        ],
      });

      expect(service.resolveTitleModelConfig()).toMatchObject({
        id: 'system:openai:secondary',
      });
    });

    it('treats a title-generation role that is not configured as unset', () => {
      const service = createService({
        defaultSelector: 'system:openai:gpt-5.4-mini',
        titleGenerationSelector: '@missing',
      });

      expect(service.resolveTitleModelConfig()).toBeUndefined();
    });
  });

  describe('nextCandidate', () => {
    const service = createService({
      defaultSelector: '@coding',
      models: [
        withBilling('system:openai:primary', 'subscription'),
        withBilling('system:openai:secondary', 'usage'),
        withBilling('system:openai:third', 'free'),
        withBilling('system:openai:elsewhere', 'free'),
      ],
      modelRoles: [
        {
          name: 'coding',
          candidates: [
            { modelId: 'system:openai:primary', effort: 'high' },
            { modelId: 'system:openai:secondary' },
            { modelId: 'system:openai:third' },
          ],
        },
      ],
    });

    it('answers the next configured model and candidate effort', () => {
      expect(
        service.nextCandidate('@coding', 'system:openai:primary'),
      ).toMatchObject({
        modelId: 'system:openai:secondary',
        model: { id: 'system:openai:secondary', billing: 'usage' },
      });

      expect(
        service.nextCandidate('@coding', 'system:openai:secondary'),
      ).toMatchObject({
        modelId: 'system:openai:third',
        model: { id: 'system:openai:third', billing: 'free' },
      });
    });

    it('never wraps and never leaves the role', () => {
      expect(
        service.nextCandidate('@coding', 'system:openai:third'),
      ).toBeUndefined();
      expect(
        service.nextCandidate('@coding', 'system:openai:elsewhere'),
      ).toBeUndefined();
      expect(
        service.nextCandidate('system:openai:primary', 'system:openai:primary'),
      ).toBeUndefined();
      expect(
        service.nextCandidate('@missing', 'system:openai:primary'),
      ).toBeUndefined();
    });
  });

  describe('validateModelSelection', () => {
    it('accepts an available model id when the default is configured', () => {
      const service = createService({
        defaultSelector: 'system:openai:gpt-5.4-mini',
      });

      expect(service.validateModelSelection('system:openai:gpt-4o').id).toBe(
        'system:openai:gpt-4o',
      );
    });

    it('rejects an unavailable model id with a 422 domain error when the default is valid', () => {
      const service = createService({
        defaultSelector: 'system:openai:gpt-5.4-mini',
      });

      expect(() =>
        service.validateModelSelection('system:openai:ghost'),
      ).toThrow(ModelNotAvailableError);
    });

    it('checks only the requested id: a missing default cannot mask an unavailable model', () => {
      const service = createService({ defaultSelector: null });

      // Availability is all this method owns. The default rule belongs to
      // selection resolution, which admission runs before a Run exists; a
      // worker re-check must not turn a valid exact selection into a 503 just
      // because the instance has no default.
      expect(service.validateModelSelection('system:openai:gpt-4o').id).toBe(
        'system:openai:gpt-4o',
      );
      expect(() =>
        service.validateModelSelection('system:openai:ghost'),
      ).toThrow(ModelNotAvailableError);
    });
  });

  describe('resolveEffortSelection', () => {
    const REASONING = {
      effortLevels: [
        { value: 'none' },
        { value: 'low' },
        { value: 'high', label: 'High' },
      ],
      defaultEffort: 'low',
      cacheInvalidatedByEffortChange: true,
    } as const;

    const reasoningModel: SystemModelCatalogEntry = {
      id: 'system:openai:reasoner',
      source: 'system',
      provider: 'openai',
      providerModelId: 'reasoner',
      contextWindowTokens: 128_000,
      input: ['text'],
      systemPromptTemplate: 'Internal prompt R',
      systemPromptSource: 'project_default',
      referencesSkills: false,
      reasoning: REASONING,
    };

    // Destructured out rather than deleted after the fact: `reasoning` is
    // optional, so omitting it needs no cast and no mutation.
    const { reasoning: _declared, ...plainModel } = {
      ...reasoningModel,
      id: 'system:openai:plain',
    };

    const service = () =>
      createService({
        defaultSelector: 'system:openai:reasoner',
        models: [reasoningModel, plainModel],
      });

    it('resolves the model default when the request omits an effort', () => {
      expect(service().resolveEffortSelection(reasoningModel, undefined)).toBe(
        'low',
      );
    });

    it('resolves a requested level that the model declares', () => {
      expect(service().resolveEffortSelection(reasoningModel, 'high')).toBe(
        'high',
      );
    });

    // A level meaning "do not reason" is a selection like any other; it must
    // survive resolution rather than collapsing into "nothing requested".
    it('resolves a disabling level rather than treating it as absent', () => {
      expect(service().resolveEffortSelection(reasoningModel, 'none')).toBe(
        'none',
      );
    });

    it('rejects a level the model does not declare', () => {
      expect(() =>
        service().resolveEffortSelection(reasoningModel, 'medium'),
      ).toThrow(EffortNotAvailableError);
    });

    it('rejects a published label when used as the effort value', () => {
      expect(() =>
        service().resolveEffortSelection(reasoningModel, 'High'),
      ).toThrow(EffortNotAvailableError);
    });

    // Case-sensitivity falls out of "no normalization" rather than being a
    // rule of its own — nothing folds the request onto a declared level.
    it('rejects a level differing only by letter case', () => {
      expect(() =>
        service().resolveEffortSelection(reasoningModel, 'None'),
      ).toThrow(EffortNotAvailableError);
    });

    it('rejects any effort for a model that declares no vocabulary', () => {
      expect(() => service().resolveEffortSelection(plainModel, 'low')).toThrow(
        EffortNotAvailableError,
      );
    });

    it('resolves to nothing for a model that declares no vocabulary and no request', () => {
      expect(
        service().resolveEffortSelection(plainModel, undefined),
      ).toBeUndefined();
    });

    // A level legal somewhere in the catalog is still illegal here: legality is
    // a property of the SELECTED model, never of the instance.
    it('rejects a level declared by a different catalog model', () => {
      expect(() =>
        service().resolveEffortSelection(plainModel, 'high'),
      ).toThrow(EffortNotAvailableError);
    });
  });

  describe('resolveSelection', () => {
    /** The admission clock these cases resolve against: before any `revertAt`. */
    const NOW = new Date('2026-11-23T13:00:00.000Z');

    const EFFORTS = {
      effortLevels: [{ value: 'low' }, { value: 'high', label: 'High' }],
      defaultEffort: 'low',
      cacheInvalidatedByEffortChange: true,
    } as const;

    const selectionModel = (
      id: string,
      reasoning?: ModelReasoning,
    ): SystemModelCatalogEntry => ({
      id,
      source: 'system',
      provider: 'openai',
      providerModelId: id,
      contextWindowTokens: 128_000,
      input: ['text'],
      systemPromptTemplate: `Internal prompt for ${id}`,
      systemPromptSource: 'project_default',
      referencesSkills: false,
      ...(reasoning !== undefined && { reasoning }),
    });

    const codex = selectionModel('codex', EFFORTS);

    const sonnet = selectionModel('sonnet', {
      ...EFFORTS,
      defaultEffort: 'high',
    });

    // No reasoning vocabulary: any named effort is undeclared, and an omitted
    // one resolves to no effort at all.
    const fast = selectionModel('fast');

    const roles: ReadonlyArray<ModelRoleConfig> = [
      {
        name: 'coding',
        candidates: [
          { modelId: 'codex', effort: 'high' },
          { modelId: 'sonnet' },
        ],
      },
      { name: 'fast', candidates: [{ modelId: 'fast' }] },
    ];

    function service(defaultSelector: string | null = 'codex') {
      return createService({
        defaultSelector,
        models: [codex, sonnet, fast],
        modelRoles: roles,
      });
    }

    it('resolves a named role to its first candidate and that candidate’s effort', () => {
      expect(
        service().resolveSelection(null, { selector: '@coding' }, 'owner', NOW),
      ).toMatchObject({
        selector: '@coding',
        model: { id: 'codex' },
        effort: 'high',
        nextSelection: { revision: 1, selector: '@coding', effort: 'high' },
      });
    });

    it('resolves a named exact model and its own default effort', () => {
      expect(
        service().resolveSelection(null, { selector: 'sonnet' }, 'owner', NOW),
      ).toMatchObject({
        selector: 'sonnet',
        model: { id: 'sonnet' },
        effort: 'high',
      });
    });

    it('uses the stored selector and its effort when the request names neither, writing nothing', () => {
      const resolved = service().resolveSelection(
        { revision: 4, selector: '@coding', effort: 'low' },
        {},
        'owner',
        NOW,
      );

      expect(resolved).toMatchObject({
        selector: '@coding',
        model: { id: 'codex' },
        effort: 'low',
      });
      expect(resolved.nextSelection).toBeUndefined();
    });

    it('falls through when the stored effort is not declared by the resolved model', () => {
      // The role candidate declares `high`, so an undeclared stored level
      // cannot silently reach the wire.
      expect(
        service().resolveSelection(
          { revision: 1, selector: '@coding', effort: 'xhigh' },
          {},
          'owner',
          NOW,
        ).effort,
      ).toBe('high');

      // An exact selector has no candidate effort: the model default applies.
      expect(
        service().resolveSelection(
          { revision: 2, selector: 'sonnet', effort: 'xhigh' },
          {},
          'owner',
          NOW,
        ).effort,
      ).toBe('high');
    });

    it('uses defaults.selector when the stored selector left the config, and stores it', () => {
      expect(
        service('@coding').resolveSelection(
          { revision: 7, selector: 'system:openai:gpt-4o', effort: 'low' },
          {},
          'owner',
          NOW,
        ),
      ).toMatchObject({
        selector: '@coding',
        model: { id: 'codex' },
        effort: 'high',
        nextSelection: {
          revision: 8,
          selector: '@coding',
          effort: 'high',
        },
      });
    });

    it('rejects a named selector the catalog does not offer', () => {
      expect(() =>
        service().resolveSelection(
          null,
          { selector: '@missing' },
          'owner',
          NOW,
        ),
      ).toThrow(ModelNotAvailableError);
      expect(() =>
        service().resolveSelection(null, { selector: 'ghost' }, 'owner', NOW),
      ).toThrow(ModelNotAvailableError);
    });

    it('rejects an unset defaults.selector when neither a request nor a stored selection resolves', () => {
      expect(() =>
        service(null).resolveSelection(null, {}, 'owner', NOW),
      ).toThrow(ModelConfigurationError);
      expect(() =>
        service(null).resolveSelection(null, {}, 'owner', NOW),
      ).toThrow('defaults.selector is required.');
    });

    it('rejects any effort on a model that declares no vocabulary', () => {
      expect(() =>
        service().resolveSelection(
          null,
          { selector: '@fast', effort: 'high' },
          'owner',
          NOW,
        ),
      ).toThrow(EffortNotAvailableError);
    });

    it('increments the stored revision on every owner write', () => {
      expect(
        service().resolveSelection(
          { revision: 2, selector: 'codex', effort: 'low' },
          { selector: '@coding' },
          'owner',
          NOW,
        ).nextSelection,
      ).toEqual({ revision: 3, selector: '@coding', effort: 'high' });
    });

    it('keeps the hold and pins the named effort on it when the request names only an effort', () => {
      const hold = {
        selector: '@coding',
        modelId: 'sonnet',
        effort: 'high',
        revertAt: '2026-11-23T14:00:00.000Z',
      };

      const resolved = service().resolveSelection(
        { revision: 5, selector: '@coding', effort: 'low', hold },
        { effort: 'high' },
        'owner',
        NOW,
      );

      // The hold serves the Run on `sonnet`; the named effort rides on the hold
      // while the owner's stored effort stays what a later send returns to.
      expect(resolved.selector).toBe('@coding');
      expect(resolved.model).toMatchObject({ id: 'sonnet' });
      expect(resolved.effort).toBe('high');
      expect(resolved.nextSelection).toEqual({
        revision: 6,
        selector: '@coding',
        effort: 'low',
        hold: { ...hold, effort: 'high' },
      });
    });

    it('never writes the selection for a derived creator', () => {
      expect(
        service().resolveSelection(
          null,
          { selector: '@coding' },
          'derived',
          NOW,
        ).nextSelection,
      ).toBeUndefined();
      expect(
        service().resolveSelection(
          { revision: 3, selector: 'codex', effort: 'low' },
          { effort: 'high' },
          'derived',
          NOW,
        ).nextSelection,
      ).toBeUndefined();
    });

    it('resets the stored effort when a pick resolves to a model with no vocabulary', () => {
      const pick = service().resolveSelection(
        { revision: 1, selector: 'codex', effort: 'low' },
        { selector: '@fast' },
        'owner',
        NOW,
      );

      expect(pick).toMatchObject({ selector: '@fast', model: { id: 'fast' } });
      expect(pick.effort).toBeUndefined();
      expect(pick.nextSelection).toEqual({
        revision: 2,
        selector: '@fast',
        effort: null,
      });

      // A later send with no selector and no effort is accepted on that pick.
      const later = service().resolveSelection(
        pick.nextSelection ?? null,
        {},
        'owner',
        NOW,
      );

      expect(later.selector).toBe('@fast');
      expect(later.effort).toBeUndefined();
      expect(later.nextSelection).toBeUndefined();
    });

    it('drops the hold when the request names a selector', () => {
      const hold = {
        selector: '@coding',
        modelId: 'sonnet',
        effort: 'high',
        revertAt: '2026-11-23T14:00:00.000Z',
      };

      const resolved = service().resolveSelection(
        { revision: 1, selector: '@coding', effort: 'low', hold },
        { selector: '@coding' },
        'owner',
        NOW,
      );

      expect(resolved.model).toMatchObject({ id: 'codex' });
      expect(resolved.nextSelection).not.toHaveProperty('hold');
    });
  });
});

describe('ModelsService — GET /api/v1/models contract stability (#161, providers-and-models-as-code #167)', () => {
  it('keeps account routing and prompt metadata out of the public catalogue', async () => {
    // Load a `.jsonc` copy of the `.example` template (a `cp` source, not a
    // bootable name) so the extension-based loader picks it up like a real boot.
    const { readFileSync, writeFileSync, mkdtempSync, rmSync } =
      await import('node:fs');

    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(path.join(tmpdir(), 'models-config-'));
    const copy = path.join(dir, 'llame.config.jsonc');
    writeFileSync(
      copy,
      readFileSync(
        path.resolve(__dirname, '../../llame.config.jsonc.example'),
        'utf8',
      ),
    );
    const config = loadInstanceConfig({ LLAME_CONFIG_PATH: copy });
    rmSync(dir, { recursive: true, force: true });

    const service = new ModelsService({ config, productUserAgent: USER_AGENT });
    const response = service.getAvailableModels();

    for (const model of response.models) {
      expect(model).not.toHaveProperty('providerModelId');
      expect(model).not.toHaveProperty('provider');
      expect(model).not.toHaveProperty('wire');
      expect(model).not.toHaveProperty('systemPromptTemplate');
      expect(model).not.toHaveProperty('compactionThresholdTokens');
      expect(model).not.toHaveProperty('systemPrompt');
      expect(model).not.toHaveProperty('systemPromptSource');
      expect(model).not.toHaveProperty('systemPromptFile');
      expect(model).not.toHaveProperty('billing');
    }
  });
});
