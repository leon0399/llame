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
  type: 'cohere',
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

describe('cohere provider config', () => {
  it('resolves key, baseUrl, and no default headers', () => {
    writeConfig({ providers: [COHERE_PROVIDER] });

    expect(loadInstanceConfig().providers[0]).toEqual({
      id: 'openrouter-rerank',
      type: 'cohere',
      key: 'rr-test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      headers: {},
    });
  });

  it('defaults baseUrl to the Cohere API', () => {
    writeConfig({
      providers: [{ id: 'c', type: 'cohere', key: 'k' }],
    });

    expect(loadInstanceConfig().providers[0]).toMatchObject({
      baseUrl: 'https://api.cohere.com/v2',
    });
  });

  it('requires a key', () => {
    writeConfig({ providers: [{ id: 'c', type: 'cohere' }] });

    expect(() => loadInstanceConfig()).toThrow(/key/u);
  });

  it('fails startup when the key interpolates to empty', () => {
    writeConfig({
      providers: [{ id: 'c', type: 'cohere', key: '{env:NOT_SET_RR_KEY:-}' }],
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'providers[c].key: must resolve to a nonblank string',
      ),
    );
  });

  it('fails startup when a present baseUrl interpolates to empty', () => {
    writeConfig({
      providers: [
        {
          id: 'c',
          type: 'cohere',
          key: 'k',
          baseUrl: '{env:NOT_SET_RR_URL:-}',
        },
      ],
    });

    expect(() => loadInstanceConfig()).toThrow(/providers\[c\]\.baseUrl/u);
  });

  it('rejects {session:id} in a header', () => {
    writeConfig({
      providers: [{ ...COHERE_PROVIDER, headers: { 'X-Tag': '{session:id}' } }],
    });

    expect(() => loadInstanceConfig()).toThrow(
      /a cohere provider has no Chat session/u,
    );
  });

  it('fails a models[] entry naming a cohere provider', () => {
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
      /models\[chat-on-rerank\]\.provider: .*"cohere"/u,
    );
  });

  it('fails an embeddingModels[] entry naming a cohere provider', () => {
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
      /embeddingModels\[embed-on-rerank\]\.provider: .*"cohere"/u,
    );
  });
});

describe('rerankModels config', () => {
  it('is absent when the array is not configured', () => {
    writeConfig({ providers: [COHERE_PROVIDER] });

    expect(loadInstanceConfig().rerankModels).toBeUndefined();
  });

  it('resolves the catalogue entries', () => {
    writeConfig({ providers: [COHERE_PROVIDER], rerankModels: [RERANK_MODEL] });

    expect(loadInstanceConfig().rerankModels).toEqual([RERANK_MODEL]);
  });

  it('rejects a provider that is not a cohere entry', () => {
    writeConfig({
      providers: [SYSTEM_ONE_PROVIDER],
      rerankModels: [{ ...RERANK_MODEL, provider: 'decisions' }],
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'rerankModels[0].provider: provider has type "system-one", not "cohere"',
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

  it('rejects a decision model naming a cohere provider', () => {
    writeConfig({
      providers: [COHERE_PROVIDER],
      decisionModels: [{ ...RERANK_MODEL, id: 'd' }],
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'decisionModels[0].provider: provider has type "cohere", not "system-one"',
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
        'rerankModels[0].id and rerankModels[2].id: duplicate rerank model id',
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
