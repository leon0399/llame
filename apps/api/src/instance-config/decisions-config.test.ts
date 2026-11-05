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

function loadInstanceConfig() {
  return loadInstanceConfigFromPath({
    ...process.env,
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
    pricingUsdPer1M: { input: 0.042 },
  },
];

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

  it('resolves the catalogue entries with their provider, model, and price', () => {
    configWith(CATALOGUE);

    expect(loadInstanceConfig().decisionModels).toEqual([
      {
        id: 'opencode',
        provider: 'opencode-decisions',
        model: 'jev-1.13',
      },
      {
        id: 'openrouter',
        provider: 'openrouter-decisions',
        model: '~typesafe/jev-latest',
        pricingUsdPer1M: { input: 0.042 },
      },
    ]);
  });

  it('accepts an empty catalogue and builds no client for it', () => {
    configWith([]);

    expect(loadInstanceConfig().decisionModels).toEqual([]);
  });

  it('rejects a duplicate catalogue id', () => {
    configWith([
      { id: 'jev', provider: 'opencode-decisions', model: 'jev-1.13' },
      { id: 'jev', provider: 'opencode-decisions', model: 'jev-1.13' },
    ]);

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'decisionModels: duplicate decision model id "jev"',
      ),
    );
  });

  it('rejects a catalogue entry naming a provider that does not exist', () => {
    configWith([{ id: 'jev', provider: 'missing', model: 'jev-1.13' }]);

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'decisionModels[jev].provider: unknown provider id "missing" (not defined in providers[])',
      ),
    );
  });

  it('rejects a catalogue entry naming a provider that is not a system-one entry', () => {
    configWith([{ id: 'jev', provider: 'openai', model: 'jev-1.13' }], {
      providers: [{ id: 'openai', type: 'openai-responses', key: 'sk-test' }],
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'decisionModels[jev].provider: provider "openai" has type "openai-responses", not "system-one"',
      ),
    );
  });

  it('rejects a catalogue model id that resolves blank', () => {
    configWith([{ id: 'jev', provider: 'opencode-decisions', model: '   ' }]);

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'decisionModels[jev].model: must resolve to a nonblank string',
      ),
    );
  });
});

describe('per-tool rerank config', () => {
  it('resolves webSearch.rerank and tools.grep.rerank against the catalogue', () => {
    configWith(CATALOGUE, {
      webSearch: {
        ...WEB_SEARCH,
        rerank: { mode: 'shadow', model: 'openrouter' },
      },
      grep: { rerank: { mode: 'on', model: 'opencode' } },
    });

    const config = loadInstanceConfig();
    expect(config.webSearch?.rerank).toEqual({
      mode: 'shadow',
      model: 'openrouter',
    });
    expect(config.tools.grep.rerank).toEqual({ mode: 'on', model: 'opencode' });
  });

  it('leaves both tools off when no rerank block is configured', () => {
    configWith(CATALOGUE, { webSearch: WEB_SEARCH, grep: {} });

    const config = loadInstanceConfig();
    expect(config.webSearch).not.toHaveProperty('rerank');
    expect(config.tools.grep).not.toHaveProperty('rerank');
  });

  it('rejects webSearch.rerank naming an id outside the catalogue', () => {
    configWith(CATALOGUE, {
      webSearch: {
        ...WEB_SEARCH,
        rerank: { mode: 'shadow', model: 'missing' },
      },
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'webSearch.rerank.model: unknown decision model id "missing" (not defined in decisionModels[])',
      ),
    );
  });

  it('rejects tools.grep.rerank naming an id outside the catalogue', () => {
    configWith(CATALOGUE, {
      grep: { rerank: { mode: 'shadow', model: 'missing' } },
    });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'tools.grep.rerank.model: unknown decision model id "missing" (not defined in decisionModels[])',
      ),
    );
  });

  it('rejects a rerank block while no catalogue exists', () => {
    configWith(undefined, {
      grep: { rerank: { mode: 'shadow', model: 'opencode' } },
    });

    expect(() => loadInstanceConfig()).toThrow(
      /tools\.grep\.rerank\.model: unknown decision model id "opencode"/u,
    );
  });

  it('rejects an "off" mode: removing the block is how a tool stops reranking', () => {
    configWith(CATALOGUE, {
      grep: { rerank: { mode: 'off', model: 'opencode' } },
    });

    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  it('rejects a rerank block without a model', () => {
    configWith(CATALOGUE, { grep: { rerank: { mode: 'shadow' } } });

    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });
});

describe('system-one provider config', () => {
  it('requires a system-one provider to carry a key and a baseUrl', () => {
    writeConfig({
      providers: [{ id: 'native', type: 'system-one', key: 'k' }],
    });

    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
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

  it('gives a system-one provider no session header by default', () => {
    writeConfig({ providers: [SYSTEM_ONE_PROVIDER] });

    const provider = loadInstanceConfig().providers[0];
    expect(provider).toMatchObject({
      id: 'opencode-decisions',
      type: 'system-one',
      baseUrl: 'https://opencode.ai/zen/v1',
      headers: {},
    });
  });
});
