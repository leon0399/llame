import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { InstanceConfigError } from '@workspace/config-interpolation';
import { type UnknownRecord } from '@workspace/runtime-safety';

import { loadInstanceConfig as loadInstanceConfigFromPath } from './config-loader';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'llame-decisions-config-'));
});

function writeConfig(content: UnknownRecord): void {
  writeFileSync(
    path.join(tmpDir, 'llame.config.json'),
    JSON.stringify(content),
  );
}

function loadInstanceConfig(env: NodeJS.ProcessEnv = {}) {
  return loadInstanceConfigFromPath({
    ...process.env,
    ...env,
    LLAME_CONFIG_PATH: path.join(tmpDir, 'llame.config.json'),
  });
}

const SYSTEM_ONE_PROVIDER = {
  id: 'opencode-decisions',
  type: 'system-one',
  key: 'oc-test-key',
  baseUrl: 'https://opencode.ai/zen/v1',
};

const OPENROUTER_PROVIDER = {
  id: 'openrouter-decisions',
  type: 'system-one',
  key: 'or-test-key',
  baseUrl: 'https://openrouter.ai/api/v1',
};

const CHAT_PROVIDER = {
  id: 'openai',
  type: 'openai-responses',
  key: 'sk-test',
};

const CATALOGUE = [
  {
    id: 'opencode',
    provider: 'opencode-decisions',
    model: 'jev-1.13',
  },
  {
    id: 'openrouter',
    provider: 'openrouter-decisions',
    model: '~typesafe/jev-latest',
  },
];

const DEFAULT_LIMITS = {
  perQuestionContextTokens: 8192,
  perRequestContextTokens: 32_768,
  maxQuestionsPerRequest: null,
};

const WEB_SEARCH = {
  engines: [{ id: 'duckduckgo', type: 'duckduckgo' }],
  chain: ['duckduckgo'],
};

function configWith(
  decisionModels: ReadonlyArray<unknown> | undefined,
  options: {
    readonly providers?: ReadonlyArray<unknown>;
    readonly webSearch?: UnknownRecord;
    readonly grep?: UnknownRecord;
  } = {},
): void {
  writeConfig({
    providers: options.providers ?? [SYSTEM_ONE_PROVIDER, OPENROUTER_PROVIDER],
    ...(decisionModels !== undefined && { decisionModels }),
    ...(options.webSearch !== undefined && { webSearch: options.webSearch }),
    ...(options.grep !== undefined && { tools: { grep: options.grep } }),
  });
}

describe('decisionModels config', () => {
  it('is absent when the array is not configured', () => {
    configWith(undefined);
    expect(loadInstanceConfig().decisionModels).toBeUndefined();
  });

  it('resolves the catalogue entries with their provider, model, and default limits', () => {
    configWith(CATALOGUE);

    expect(loadInstanceConfig().decisionModels).toEqual([
      {
        id: 'opencode',
        provider: 'opencode-decisions',
        model: 'jev-1.13',
        limits: DEFAULT_LIMITS,
      },
      {
        id: 'openrouter',
        provider: 'openrouter-decisions',
        model: '~typesafe/jev-latest',
        limits: DEFAULT_LIMITS,
      },
    ]);
  });

  it('accepts an empty catalogue', () => {
    configWith([]);

    expect(loadInstanceConfig().decisionModels).toEqual([]);
  });

  it('rejects a catalogue entry that carries a price', () => {
    configWith([{ ...CATALOGUE[0], pricingUsdPer1M: { input: 0.042 } }]);

    expect(() => loadInstanceConfig()).toThrow(/pricingUsdPer1M/u);
  });

  it('rejects a duplicate catalogue id naming both array indices', () => {
    configWith([
      { id: 'jev', provider: 'opencode-decisions', model: 'jev-1.13' },
      { id: 'other', provider: 'opencode-decisions', model: 'jev-1.13' },
      { id: 'jev', provider: 'opencode-decisions', model: 'jev-1.13' },
    ]);

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'decisionModels[0].id and decisionModels[2].id: duplicate decision model id',
      ),
    );
  });

  it('does not print an interpolated duplicate id', () => {
    configWith([
      { id: '{env:DECISION_ID}', provider: 'opencode-decisions', model: 'm' },
      { id: 'secret-shared-id', provider: 'opencode-decisions', model: 'm' },
    ]);

    let message = '';

    try {
      loadInstanceConfig({ DECISION_ID: 'secret-shared-id' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toBe(
      'decisionModels[0].id and decisionModels[1].id: duplicate decision model id',
    );
    expect(message).not.toContain('secret-shared-id');
  });

  it.each([
    ['literal blank', ''],
    ['whitespace', '   '],
    ['empty interpolation', '{env:NOT_SET_DECISION_ID:-}'],
  ])('rejects an id that is a %s, naming its array-index path', (_, id) => {
    configWith([
      CATALOGUE[0],
      { id, provider: 'opencode-decisions', model: 'jev-1.13' },
    ]);

    expect(() => loadInstanceConfig()).toThrow(
      'decisionModels[1].id: must resolve to a nonblank string',
    );
  });

  it('rejects a catalogue entry naming a provider that does not exist', () => {
    configWith([{ id: 'jev', provider: 'missing', model: 'jev-1.13' }]);

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'decisionModels[0].provider: does not reference any configured providers[].id',
      ),
    );
  });

  it('rejects a catalogue entry naming a provider that is not a system-one entry', () => {
    configWith([{ id: 'jev', provider: 'openai', model: 'jev-1.13' }], {
      providers: [CHAT_PROVIDER],
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'decisionModels[0].provider: provider has type "openai-responses", not "system-one"',
      ),
    );
  });

  it.each([
    ['whitespace', '   '],
    ['empty interpolation', '{env:NOT_SET_DECISION_MODEL:-}'],
  ])('rejects a model that is %s', (_, model) => {
    configWith([{ id: 'jev', provider: 'opencode-decisions', model }]);

    expect(() => loadInstanceConfig()).toThrow(
      'decisionModels[0].model: must resolve to a nonblank string',
    );
  });

  it('resolves id, provider, and model through interpolation', () => {
    configWith([
      {
        id: '{env:DECISION_ID}',
        provider: '{env:DECISION_PROVIDER}',
        model: '{env:DECISION_MODEL}',
      },
    ]);

    expect(
      loadInstanceConfig({
        DECISION_ID: 'jev',
        DECISION_PROVIDER: 'opencode-decisions',
        DECISION_MODEL: 'jev-1.13',
      }).decisionModels,
    ).toEqual([
      {
        id: 'jev',
        provider: 'opencode-decisions',
        model: 'jev-1.13',
        limits: DEFAULT_LIMITS,
      },
    ]);
  });

  it('rejects an empty provider interpolation naming the array-index path', () => {
    configWith([
      {
        id: 'jev',
        provider: '{env:NOT_SET_DECISION_PROVIDER:-}',
        model: 'jev-1.13',
      },
    ]);

    expect(() => loadInstanceConfig()).toThrow(
      'decisionModels[0].provider: must resolve to a nonblank string',
    );
  });

  it('names the provider path and leaks no catalogue value when an interpolated id has an invalid provider', () => {
    configWith([
      {
        id: '{env:DECISION_ID}',
        provider: 'missing-provider',
        model: '{env:DECISION_MODEL}',
      },
    ]);

    let message = '';

    try {
      loadInstanceConfig({
        DECISION_ID: 'sk-secret-looking-id',
        DECISION_MODEL: 'sk-secret-looking-model',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toContain('decisionModels[0].provider');
    expect(message).not.toContain('sk-secret-looking');
  });

  it('loads a chat model and a decision model that share an id', () => {
    writeConfig({
      providers: [CHAT_PROVIDER, SYSTEM_ONE_PROVIDER],
      models: [
        {
          id: 'shared',
          provider: 'openai',
          providerModelId: 'gpt-test',
          contextWindowTokens: 128_000,
        },
      ],
      decisionModels: [
        { id: 'shared', provider: 'opencode-decisions', model: 'jev-1.13' },
      ],
    });

    const config = loadInstanceConfig();
    expect(config.models.map((model) => model.id)).toEqual(['shared']);
    expect(config.decisionModels?.map((model) => model.id)).toEqual(['shared']);
  });
});

describe('per-tool rerank config', () => {
  it('resolves webSearch.rerank and tools.grep.rerank against the catalogue', () => {
    configWith(CATALOGUE, {
      webSearch: { ...WEB_SEARCH, rerank: { model: 'openrouter' } },
      grep: { rerank: { model: 'opencode' } },
    });

    const config = loadInstanceConfig();
    expect(config.webSearch?.rerank).toEqual({ model: 'openrouter' });
    expect(config.tools.grep.rerank).toEqual({ model: 'opencode' });
  });

  it('resolves an interpolated rerank model', () => {
    configWith(CATALOGUE, {
      grep: { rerank: { model: '{env:GREP_RERANK_MODEL}' } },
    });

    expect(
      loadInstanceConfig({ GREP_RERANK_MODEL: 'opencode' }).tools.grep.rerank,
    ).toEqual({ model: 'opencode' });
  });

  it('keeps both tools without ranking when no rerank block is configured', () => {
    configWith(CATALOGUE, { webSearch: WEB_SEARCH, grep: {} });

    const config = loadInstanceConfig();
    expect(config.webSearch).not.toHaveProperty('rerank');
    expect(config.tools.grep).not.toHaveProperty('rerank');
  });

  it('rejects webSearch.rerank naming an id outside the catalogue', () => {
    configWith(CATALOGUE, {
      webSearch: { ...WEB_SEARCH, rerank: { model: 'missing' } },
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'webSearch.rerank.model: does not reference any configured decisionModels[].id or rerankModels[].id',
      ),
    );
  });

  it('rejects tools.grep.rerank naming an id outside the catalogue', () => {
    configWith(CATALOGUE, { grep: { rerank: { model: 'missing' } } });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'tools.grep.rerank.model: does not reference any configured decisionModels[].id or rerankModels[].id',
      ),
    );
  });

  it('rejects a rerank block while no catalogue exists', () => {
    configWith(undefined, { grep: { rerank: { model: 'opencode' } } });

    expect(() => loadInstanceConfig()).toThrow(
      'tools.grep.rerank.model: does not reference any configured decisionModels[].id or rerankModels[].id',
    );
  });

  it.each([
    ['literal blank', ''],
    ['whitespace', '  '],
    ['empty interpolation', '{env:NOT_SET_RERANK_MODEL:-}'],
  ])('rejects a webSearch.rerank.model that is a %s', (_, model) => {
    configWith(CATALOGUE, {
      webSearch: { ...WEB_SEARCH, rerank: { model } },
    });

    expect(() => loadInstanceConfig()).toThrow(
      'webSearch.rerank.model: must resolve to a nonblank string',
    );
  });

  it.each([
    ['literal blank', ''],
    ['whitespace', '  '],
    ['empty interpolation', '{env:NOT_SET_RERANK_MODEL:-}'],
  ])('rejects a tools.grep.rerank.model that is a %s', (_, model) => {
    configWith(CATALOGUE, { grep: { rerank: { model } } });

    expect(() => loadInstanceConfig()).toThrow(
      'tools.grep.rerank.model: must resolve to a nonblank string',
    );
  });

  it('rejects a mode on either rerank block', () => {
    configWith(CATALOGUE, {
      webSearch: {
        ...WEB_SEARCH,
        rerank: { mode: 'on', model: 'opencode' },
      },
    });
    expect(() => loadInstanceConfig()).toThrow(/mode/u);

    configWith(CATALOGUE, {
      grep: { rerank: { mode: 'shadow', model: 'opencode' } },
    });
    expect(() => loadInstanceConfig()).toThrow(/mode/u);
  });

  it('rejects a rerank block without a model', () => {
    configWith(CATALOGUE, { grep: { rerank: {} } });

    expect(() => loadInstanceConfig()).toThrow(
      /\/tools\/grep\/rerank: must have required property 'model'/u,
    );
  });
});

describe('system-one provider config', () => {
  it('requires a system-one provider to carry a key', () => {
    writeConfig({
      providers: [
        { id: 'native', type: 'system-one', baseUrl: 'https://x.example/v1' },
      ],
    });

    expect(() => loadInstanceConfig()).toThrow(
      /\/providers\[native\]: must have required property 'key'/u,
    );
  });

  it('requires a system-one provider to carry a baseUrl', () => {
    writeConfig({
      providers: [{ id: 'native', type: 'system-one', key: 'k' }],
    });

    expect(() => loadInstanceConfig()).toThrow(
      /\/providers\[native\]: must have required property 'baseUrl'/u,
    );
  });

  it('fails startup when the system-one key interpolates to empty', () => {
    writeConfig({
      providers: [
        {
          id: 'native',
          type: 'system-one',
          key: '{env:NOT_SET_DECISIONS_KEY:-}',
          baseUrl: 'https://api.typesafe.ai/v1',
        },
      ],
    });

    expect(() => loadInstanceConfig()).toThrow(
      'providers[native].key: must resolve to a nonblank string',
    );
  });

  it('fails startup when the system-one baseUrl interpolates to empty', () => {
    writeConfig({
      providers: [
        {
          id: 'native',
          type: 'system-one',
          key: 'k',
          baseUrl: '{env:NOT_SET_DECISIONS_URL:-}',
        },
      ],
    });

    expect(() => loadInstanceConfig()).toThrow(
      'providers[native].baseUrl: must resolve to a nonblank string',
    );
  });

  it('rejects an accountId on a system-one provider', () => {
    writeConfig({
      providers: [{ ...SYSTEM_ONE_PROVIDER, accountId: 'acct' }],
    });

    expect(() => loadInstanceConfig()).toThrow(
      /\/providers\[opencode-decisions\]\/accountId/u,
    );
  });

  it('gives a system-one provider no default header and keeps billing', () => {
    writeConfig({
      providers: [{ ...SYSTEM_ONE_PROVIDER, billing: 'subscription' }],
    });

    expect(loadInstanceConfig().providers[0]).toMatchObject({
      id: 'opencode-decisions',
      type: 'system-one',
      baseUrl: 'https://opencode.ai/zen/v1',
      billing: 'subscription',
      headers: {},
    });
  });

  it('keeps an operator header literal on a system-one provider', () => {
    writeConfig({
      providers: [
        { ...SYSTEM_ONE_PROVIDER, headers: { 'X-Tag': 'decisions' } },
      ],
    });

    expect(loadInstanceConfig().providers[0]).toMatchObject({
      headers: { 'X-Tag': ['decisions'] },
    });
  });

  it('rejects an authored {session:id} header naming the provider and header', () => {
    writeConfig({
      providers: [
        { ...SYSTEM_ONE_PROVIDER, headers: { 'X-Tag': 'run-{session:id}' } },
      ],
    });

    expect(() => loadInstanceConfig()).toThrow(
      /providers\[opencode-decisions\]\.headers\.X-Tag/u,
    );
  });

  it('does not rescan interpolated header output for {session:id}', () => {
    writeConfig({
      providers: [
        { ...SYSTEM_ONE_PROVIDER, headers: { 'X-Tag': '{env:TAG}' } },
      ],
    });

    expect(
      loadInstanceConfig({ TAG: '{session:id}' }).providers[0],
    ).toMatchObject({ headers: { 'X-Tag': ['{session:id}'] } });
  });

  it('still renders {session:id} for a chat provider', () => {
    writeConfig({
      providers: [
        { ...CHAT_PROVIDER, headers: { 'X-Tag': 'run-{session:id}' } },
      ],
    });

    expect(loadInstanceConfig().providers[0]).toMatchObject({
      headers: { 'X-Tag': ['run-', ''] },
    });
  });
});

describe('model entries cannot name a decision provider', () => {
  it('fails a models[] entry naming a system-one provider', () => {
    writeConfig({
      providers: [SYSTEM_ONE_PROVIDER],
      models: [
        {
          id: 'chat-on-decisions',
          provider: 'opencode-decisions',
          providerModelId: 'jev-1.13',
          contextWindowTokens: 128_000,
        },
      ],
    });

    expect(() => loadInstanceConfig()).toThrow(
      /models\[chat-on-decisions\]\.provider: .*"system-one"/u,
    );
  });

  it('fails an embeddingModels[] entry naming a system-one provider', () => {
    writeConfig({
      providers: [SYSTEM_ONE_PROVIDER],
      embeddingModels: [
        {
          id: 'embed-on-decisions',
          provider: 'opencode-decisions',
          providerModelId: 'jev-1.13',
          dimensions: 8,
        },
      ],
    });

    expect(() => loadInstanceConfig()).toThrow(
      /embeddingModels\[embed-on-decisions\]\.provider: .*"system-one"/u,
    );
  });
});

describe('decision model limits config', () => {
  function limitsOf(env: NodeJS.ProcessEnv = {}) {
    return loadInstanceConfig(env).decisionModels?.[0]?.limits;
  }

  it('keeps declared limits and defaults the per-request limit', () => {
    configWith([
      {
        ...CATALOGUE[0],
        limits: { perQuestionContextTokens: 1024, maxQuestionsPerRequest: 16 },
      },
    ]);

    expect(limitsOf()).toEqual({
      perQuestionContextTokens: 1024,
      perRequestContextTokens: 32_768,
      maxQuestionsPerRequest: 16,
    });
  });

  it('raises the per-request default to a larger declared per-question limit', () => {
    configWith([
      { ...CATALOGUE[0], limits: { perQuestionContextTokens: 65_536 } },
    ]);

    expect(limitsOf()).toEqual({
      perQuestionContextTokens: 65_536,
      perRequestContextTokens: 65_536,
      maxQuestionsPerRequest: null,
    });
  });

  it('resolves a whole-value interpolation token', () => {
    configWith([
      {
        ...CATALOGUE[0],
        limits: { perQuestionContextTokens: '{env:LAYA_WINDOW}' },
      },
    ]);

    expect(limitsOf({ LAYA_WINDOW: '1024' })?.perQuestionContextTokens).toBe(
      1024,
    );
  });

  it.each([
    ['a negative value', { perRequestContextTokens: -1 }],
    ['a fractional value', { maxQuestionsPerRequest: 2.5 }],
    ['an unknown field', { contextWindowTokens: 1024 }],
  ])('rejects %s naming the limits path', (_name, limits) => {
    configWith([{ ...CATALOGUE[0], limits }]);

    expect(() => loadInstanceConfig()).toThrow(/limits/u);
  });

  it('rejects a per-question limit above the per-request limit', () => {
    configWith([
      {
        ...CATALOGUE[0],
        limits: {
          perQuestionContextTokens: 65_536,
          perRequestContextTokens: 32_768,
        },
      },
    ]);

    expect(() => loadInstanceConfig()).toThrow(
      'decisionModels[0].limits: perQuestionContextTokens must not exceed perRequestContextTokens',
    );
  });

  it('rejects an interpolated limit that is not an integer without printing it', () => {
    configWith([
      {
        ...CATALOGUE[0],
        limits: { perQuestionContextTokens: '{env:LAYA_WINDOW}' },
      },
    ]);

    let message = '';

    try {
      loadInstanceConfig({ LAYA_WINDOW: '1024.5' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toContain(
      'decisionModels[0].limits.perQuestionContextTokens',
    );
    expect(message).not.toContain('1024.5');
  });
});

describe('system-one maxConcurrentRequests config', () => {
  function bound(provider: UnknownRecord, env: NodeJS.ProcessEnv = {}) {
    configWith(CATALOGUE.slice(0, 1), {
      providers: [{ ...SYSTEM_ONE_PROVIDER, ...provider }],
    });

    const resolved = loadInstanceConfig(env).providers.find(
      (entry) => entry.id === SYSTEM_ONE_PROVIDER.id,
    );

    return resolved?.type === 'system-one'
      ? resolved.maxConcurrentRequests
      : undefined;
  }

  it('defaults to four', () => {
    expect(bound({})).toBe(4);
  });

  it('keeps a declared bound and resolves a token', () => {
    expect(bound({ maxConcurrentRequests: 16 })).toBe(16);
    expect(
      bound(
        { maxConcurrentRequests: '{env:DECISION_SLOTS}' },
        { DECISION_SLOTS: '2' },
      ),
    ).toBe(2);
  });

  it.each([0, 2.5])('rejects %s naming the entry and the field', (value) => {
    expect(() => bound({ maxConcurrentRequests: value })).toThrow(
      /maxConcurrentRequests/u,
    );
  });

  it('rejects the field on another provider type', () => {
    configWith(undefined, {
      providers: [{ ...CHAT_PROVIDER, maxConcurrentRequests: 4 }],
    });

    expect(() => loadInstanceConfig()).toThrow(/maxConcurrentRequests/u);
  });
});
