import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { InstanceConfigError } from '@workspace/config-interpolation';
import { type UnknownRecord } from '@workspace/runtime-safety';

import { loadInstanceConfig as loadInstanceConfigFromPath } from './config-loader';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'llame-rerank-config-'));
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

const COHERE_PROVIDER = {
  id: 'openrouter-rerank',
  type: 'cohere-rerank',
  key: 'rr-test-key',
  baseUrl: 'https://openrouter.ai/api/v1',
};

const SYSTEM_ONE_PROVIDER = {
  id: 'decisions',
  type: 'system-one',
  key: 'sys-test-key',
  baseUrl: 'https://decisions.example/v1',
};

const RERANK_MODEL = {
  id: 'rr-fast',
  provider: 'openrouter-rerank',
  model: 'cohere/rerank-5-fast',
};

describe('cohere-rerank provider config', () => {
  it('defaults baseUrl to the Cohere API and has no default headers', () => {
    writeConfig({
      providers: [{ id: 'c', type: 'cohere-rerank', key: 'k' }],
    });

    expect(loadInstanceConfig().providers[0]).toEqual({
      id: 'c',
      type: 'cohere-rerank',
      key: 'k',
      baseUrl: 'https://api.cohere.com/v2',
      headers: {},
    });
  });

  it('resolves key, baseUrl, and headers through interpolation and keeps billing', () => {
    writeConfig({
      providers: [
        {
          id: 'c',
          type: 'cohere-rerank',
          key: '{env:RR_KEY}',
          baseUrl: '{env:RR_URL}',
          billing: 'subscription',
          headers: { 'X-Tag': 'rr' },
        },
      ],
    });

    expect(
      loadInstanceConfig({ RR_KEY: 'k1', RR_URL: 'https://rr.example/v2' })
        .providers[0],
    ).toEqual({
      id: 'c',
      type: 'cohere-rerank',
      key: 'k1',
      baseUrl: 'https://rr.example/v2',
      billing: 'subscription',
      headers: { 'X-Tag': ['rr'] },
    });
  });

  it('loads a keyless entry with an explicit baseUrl', () => {
    writeConfig({
      providers: [
        {
          id: 'infinity',
          type: 'cohere-rerank',
          baseUrl: 'http://infinity:7997',
        },
        {
          id: 'blank-key',
          type: 'cohere-rerank',
          key: '{env:NOT_SET_RR_KEY:-}',
          baseUrl: 'http://infinity:7997',
        },
      ],
    });

    expect(loadInstanceConfig().providers).toMatchObject([
      { id: 'infinity', key: null, baseUrl: 'http://infinity:7997' },
      { id: 'blank-key', key: null, baseUrl: 'http://infinity:7997' },
    ]);
  });

  it.each([
    ['absent', {}],
    ['blank after interpolation', { key: '{env:NOT_SET_RR_KEY:-}' }],
  ])(
    'fails a keyless entry on the default endpoint when the key is %s',
    (_name, key) => {
      writeConfig({ providers: [{ id: 'c', type: 'cohere-rerank', ...key }] });

      expect(() => loadInstanceConfig()).toThrow(/providers\[c\]\.key/u);
    },
  );

  it('fails startup when a present baseUrl interpolates to empty', () => {
    writeConfig({
      providers: [
        {
          id: 'c',
          type: 'cohere-rerank',
          key: 'k',
          baseUrl: '{env:NOT_SET_RR_URL:-}',
        },
      ],
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'providers[c].baseUrl: must resolve to a nonblank string',
      ),
    );
  });

  it('rejects an accountId naming the entry and field', () => {
    writeConfig({
      providers: [{ ...COHERE_PROVIDER, accountId: 'acct' }],
    });

    expect(() => loadInstanceConfig()).toThrow(/accountId/u);
  });

  it('rejects an authored {session:id} header naming the provider and header', () => {
    writeConfig({
      providers: [{ ...COHERE_PROVIDER, headers: { 'X-Tag': '{session:id}' } }],
    });

    expect(() => loadInstanceConfig()).toThrow(
      /providers\[openrouter-rerank\]\.headers\.X-Tag: a cohere-rerank provider has no Chat session/u,
    );
  });

  it('fails a models[] entry naming a cohere-rerank provider', () => {
    writeConfig({
      providers: [COHERE_PROVIDER],
      models: [
        {
          id: 'chat-on-rerank',
          provider: 'openrouter-rerank',
          providerModelId: 'cohere/rerank-5-fast',
          contextWindowTokens: 128_000,
        },
      ],
    });

    expect(() => loadInstanceConfig()).toThrow(
      /models\[chat-on-rerank\]\.provider: .*"cohere-rerank"/u,
    );
  });

  it('fails an embeddingModels[] entry naming a cohere-rerank provider', () => {
    writeConfig({
      providers: [COHERE_PROVIDER],
      embeddingModels: [
        {
          id: 'embed-on-rerank',
          provider: 'openrouter-rerank',
          providerModelId: 'cohere/rerank-5-fast',
          dimensions: 8,
        },
      ],
    });

    expect(() => loadInstanceConfig()).toThrow(
      /embeddingModels\[embed-on-rerank\]\.provider: .*"cohere-rerank"/u,
    );
  });
});

describe('rerankModels config', () => {
  it('is absent when the array is not configured', () => {
    writeConfig({ providers: [COHERE_PROVIDER] });

    expect(loadInstanceConfig().rerankModels).toBeUndefined();
  });

  it('resolves id, provider, and model through interpolation', () => {
    writeConfig({
      providers: [COHERE_PROVIDER],
      rerankModels: [
        {
          id: '{env:RR_ID}',
          provider: '{env:RR_PROVIDER}',
          model: '{env:RR_MODEL}',
        },
      ],
    });

    expect(
      loadInstanceConfig({
        RR_ID: 'rr-fast',
        RR_PROVIDER: 'openrouter-rerank',
        RR_MODEL: 'cohere/rerank-5-fast',
      }).rerankModels,
    ).toEqual([RERANK_MODEL]);
  });

  it.each(['id', 'model'] as const)(
    'rejects a blank %s naming its array-index path',
    (field) => {
      writeConfig({
        providers: [COHERE_PROVIDER],
        rerankModels: [
          RERANK_MODEL,
          {
            ...RERANK_MODEL,
            id: 'second',
            [field]: '{env:NOT_SET_RR_FIELD:-}',
          },
        ],
      });

      expect(() => loadInstanceConfig()).toThrow(
        new InstanceConfigError(
          `rerankModels[1].${field}: must resolve to a nonblank string`,
        ),
      );
    },
  );

  it('names both paths and no value when an interpolated id repeats', () => {
    writeConfig({
      providers: [COHERE_PROVIDER, SYSTEM_ONE_PROVIDER],
      decisionModels: [
        { id: '{env:SHARED_ID}', provider: 'decisions', model: 'jev' },
      ],
      rerankModels: [{ ...RERANK_MODEL, id: '{env:SHARED_ID}' }],
    });

    let message = '';
    try {
      loadInstanceConfig({ SHARED_ID: 'sk-secret-looking-id' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toContain('decisionModels[0].id');
    expect(message).toContain('rerankModels[0].id');
    expect(message).not.toContain('sk-secret-looking-id');
  });

  it('rejects a provider that is not a cohere-rerank entry', () => {
    writeConfig({
      providers: [SYSTEM_ONE_PROVIDER],
      rerankModels: [{ ...RERANK_MODEL, provider: 'decisions' }],
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'rerankModels[0].provider: provider has type "system-one", not "cohere-rerank"',
      ),
    );
  });

  it('rejects an unknown provider id', () => {
    writeConfig({
      providers: [COHERE_PROVIDER],
      rerankModels: [{ ...RERANK_MODEL, provider: 'nope' }],
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'rerankModels[0].provider: does not reference any configured providers[].id',
      ),
    );
  });

  it('rejects a decision model naming a cohere-rerank provider', () => {
    writeConfig({
      providers: [COHERE_PROVIDER],
      decisionModels: [{ ...RERANK_MODEL, id: 'd' }],
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'decisionModels[0].provider: provider has type "cohere-rerank", not "system-one"',
      ),
    );
  });

  it('rejects a duplicate id within the catalogue naming both indices', () => {
    writeConfig({
      providers: [COHERE_PROVIDER],
      rerankModels: [RERANK_MODEL, { ...RERANK_MODEL, id: 'x' }, RERANK_MODEL],
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'rerankModels[0].id and rerankModels[2].id: duplicate rank model id',
      ),
    );
  });

  it('rejects an id shared with a decision model', () => {
    writeConfig({
      providers: [COHERE_PROVIDER, SYSTEM_ONE_PROVIDER],
      decisionModels: [
        { id: 'other', provider: 'decisions', model: 'jev' },
        { id: 'rr-fast', provider: 'decisions', model: 'jev' },
      ],
      rerankModels: [RERANK_MODEL],
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'decisionModels[1].id and rerankModels[0].id: duplicate rank model id',
      ),
    );
  });

  it('lets a tool rerank block name a reranker or a decision model', () => {
    writeConfig({
      providers: [COHERE_PROVIDER, SYSTEM_ONE_PROVIDER],
      decisionModels: [{ id: 'jev', provider: 'decisions', model: 'jev' }],
      rerankModels: [RERANK_MODEL],
      webSearch: {
        engines: [{ id: 'duckduckgo', type: 'duckduckgo' }],
        chain: ['duckduckgo'],
        rerank: { model: 'rr-fast' },
      },
      tools: { grep: { rerank: { model: 'jev' } } },
    });

    const config = loadInstanceConfig();
    expect(config.webSearch?.rerank).toEqual({ model: 'rr-fast' });
    expect(config.tools.grep.rerank).toEqual({ model: 'jev' });
  });

  it('still rejects a rerank block naming no catalogue id', () => {
    writeConfig({
      providers: [COHERE_PROVIDER],
      rerankModels: [RERANK_MODEL],
      tools: { grep: { rerank: { model: 'missing' } } },
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'tools.grep.rerank.model: does not reference any configured decisionModels[].id or rerankModels[].id',
      ),
    );
  });
});
